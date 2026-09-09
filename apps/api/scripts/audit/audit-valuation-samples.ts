import { writeFile } from 'node:fs/promises';
import { prisma } from '../../src/infra/database/prisma.js';
import {
  resolveFinancialState,
  resolveFinancialStates,
} from '../../src/market/fundamentals/resolver.js';
import { calculateFinancialMetrics } from '../../src/market/fundamentals/metrics.js';
import {
  auditValuationState,
  VALUATION_AUDIT_METRICS,
} from '../../src/market/fundamentals/valuation-sample-audit.js';
import { canonicalStockCode } from '../../src/market/instruments/stock-identity.js';

/** Read-only source, selected-period, and historical-slice audit. Output contains no user data. */
async function main(): Promise<void> {
  const asOfDate = process.argv[2];
  const outputPath = process.argv[3];
  if (!asOfDate || !/^\d{8}$/.test(asOfDate) || !outputPath) {
    throw new Error('Usage: audit-valuation-samples.ts YYYYMMDD output.json');
  }
  const stocks = await prisma.stockBasic.findMany({ orderBy: { tsCode: 'asc' } });
  const registry = new Map(stocks.map((stock) => [canonicalStockCode(stock.tsCode), stock]));
  const sourceGroups = await Promise.all([
    prisma.financialIncomeStatement.groupBy({ by: ['tsCode'] }),
    prisma.financialBalanceSheet.groupBy({ by: ['tsCode'] }),
    prisma.financialCashFlowStatement.groupBy({ by: ['tsCode'] }),
  ]);
  const sourceCodes = [...new Set(sourceGroups.flat().map((row) => row.tsCode))].sort();
  const invalidCodes = sourceCodes.filter((code) => !/^\d{6}\.(SH|SZ|BJ)$/.test(code));
  const codes = [
    ...new Set([
      ...[...registry.keys()].filter((code) => /^\d{6}\.(SH|SZ|BJ)$/.test(code)),
      ...sourceCodes.filter((code) => !invalidCodes.includes(code)).map(canonicalStockCode),
    ]),
  ].sort();
  const latest = await Promise.all([
    prisma.daily.aggregate({ _max: { tradeDate: true } }),
    prisma.dailyBasic.aggregate({ _max: { tradeDate: true } }),
    prisma.adjFactor.aggregate({ _max: { tradeDate: true } }),
  ]);
  const ceilings = latest.map((row) => row._max.tradeDate);
  if (ceilings.some((date) => date == null)) {
    throw new Error('Missing market table');
  }
  const marketCutoff = [...(ceilings as string[]), asOfDate].sort()[0];
  const periodCoverage: Record<
    string,
    { periods: number; complete: number; metrics: Record<string, number> }
  > = {};
  const details = [];
  for (const [index, code] of codes.entries()) {
    const state = await resolveFinancialState({ tsCode: code, asOfDate });
    const calculated = calculateFinancialMetrics(state);
    details.push({
      ...auditValuationState(state, calculated),
      registryStatus: registry.get(code)?.listStatus ?? 'absent',
    });
    const complete = new Set(
      state.periods
        .filter((period) => period.income && period.balanceSheet && period.cashFlow)
        .map((period) => period.endDate),
    );
    for (const period of calculated.periods) {
      const group = periodCoverage[period.endDate] ?? { periods: 0, complete: 0, metrics: {} };
      group.periods++;
      group.complete += Number(complete.has(period.endDate));
      for (const name of VALUATION_AUDIT_METRICS) {
        if (period.metrics[name].status === 'ok' && period.metrics[name].value != null) {
          group.metrics[name] = (group.metrics[name] ?? 0) + 1;
        }
      }
      periodCoverage[period.endDate] = group;
    }
    if ((index + 1) % 500 === 0) {
      console.error(`Current-date histories ${index + 1}/${codes.length}`);
    }
  }
  const dates = Array.from(
    { length: Number(marketCutoff.slice(0, 4)) - 2015 },
    (_, index) => `${2015 + index}1231`,
  );
  dates.push(marketCutoff);
  const slices = [];
  const sliceExclusions = [];
  for (const requestedDate of dates) {
    const calendar = await prisma.tradeCal.findFirst({
      where: { exchange: 'SSE', isOpen: 1, calDate: { lte: requestedDate } },
      orderBy: { calDate: 'desc' },
    });
    if (!calendar) {
      throw new Error(`Missing calendar: ${requestedDate}`);
    }
    const date = calendar.calDate;
    const eligible = stocks.filter(
      (stock) =>
        /^\d{6}\.(SH|SZ|BJ)$/.test(stock.tsCode) &&
        stock.listDate != null &&
        stock.listDate <= date &&
        (stock.delistDate == null || stock.delistDate > date),
    );
    const identifiers = [...new Set(eligible.map((stock) => canonicalStockCode(stock.tsCode)))];
    const [prices, capitals, factors] = await Promise.all([
      prisma.daily.findMany({ where: { tradeDate: date }, select: { tsCode: true, close: true } }),
      prisma.dailyBasic.findMany({
        where: { tradeDate: date },
        select: { tsCode: true, totalMv: true },
      }),
      prisma.adjFactor.findMany({
        where: { tradeDate: date },
        select: { tsCode: true, adjFactor: true },
      }),
    ]);
    const priced = new Set(
      prices.filter((row) => row.close != null && row.close > 0).map((row) => row.tsCode),
    );
    const adjusted = new Set(factors.filter((row) => row.adjFactor > 0).map((row) => row.tsCode));
    const markets = capitals.map((row) => ({
      tsCode: row.tsCode,
      tradeDate: date,
      marketCapitalization: row.totalMv == null ? null : row.totalMv * 10000,
      sourceIdentity: `daily_basic:${row.tsCode}:${date}`,
    }));
    const slice = {
      requestedDate,
      date,
      registryEligible: identifiers.length,
      financialExcluded: 0,
      unknownIndustry: 0,
      completeLatest: 0,
      annualOperatingReady: 0,
      fcffReady: 0,
      annualFcffReady: 0,
      valuationAndAnnualFcffReady: 0,
      matchedMarket: 0,
      valuationReady: 0,
      valuationAndFcffReady: 0,
      staleReport: 0,
      shareProxyMismatch: 0,
      missing: {} as Record<string, number>,
    };
    const priceByCode = new Map(prices.map((row) => [row.tsCode, row.close]));
    for (let offset = 0; offset < identifiers.length; offset += 150) {
      const states = await resolveFinancialStates({
        tsCodes: identifiers.slice(offset, offset + 150),
        asOfDate: date,
        markets,
      });
      for (const state of states) {
        const calculated = calculateFinancialMetrics(state);
        const result = auditValuationState(state, calculated);
        const latestPeriod = state.periods.at(-1);
        const marketReady =
          priced.has(state.tsCode) &&
          adjusted.has(state.tsCode) &&
          (state.market?.marketCapitalization ?? 0) > 0;
        const ready =
          result.annualOperatingReady &&
          result.latestBridgeReady &&
          marketReady &&
          !result.staleReport;
        const shares = calculated.periods.at(-1)?.metrics.issuedShares.value;
        const close = priceByCode.get(state.tsCode);
        const shareProxyDifference =
          shares && close && state.market?.marketCapitalization
            ? state.market.marketCapitalization / shares / close - 1
            : null;
        slice.financialExcluded += Number(state.applicability === 'unsupported_financial');
        slice.unknownIndustry += Number(!result.industryKnown);
        slice.completeLatest += Number(
          Boolean(latestPeriod?.income && latestPeriod.balanceSheet && latestPeriod.cashFlow),
        );
        slice.annualOperatingReady += Number(result.annualOperatingReady);
        slice.fcffReady += Number(result.latestFcffReady);
        slice.annualFcffReady += Number(result.annualFcffReady);
        slice.valuationAndAnnualFcffReady += Number(ready && result.annualFcffReady);
        slice.matchedMarket += Number(marketReady);
        slice.valuationReady += Number(ready);
        slice.valuationAndFcffReady += Number(ready && result.latestFcffReady);
        slice.staleReport += Number(result.staleReport);
        slice.shareProxyMismatch += Number(
          shareProxyDifference != null && Math.abs(shareProxyDifference) > 0.001,
        );
        for (const [metric, reason] of Object.entries(result.missing)) {
          if (reason) {
            const key = `${metric}:${reason}`;
            slice.missing[key] = (slice.missing[key] ?? 0) + 1;
          }
        }
        if (
          !ready ||
          !result.latestFcffReady ||
          !result.industryKnown ||
          (shareProxyDifference != null && Math.abs(shareProxyDifference) > 0.001)
        ) {
          sliceExclusions.push({
            date,
            code: state.tsCode,
            ready,
            marketReady,
            annualOperatingReady: result.annualOperatingReady,
            staleReport: result.staleReport,
            industryKnown: result.industryKnown,
            annualFcffReady: result.annualFcffReady,
            annualFcffMissingReason: result.annualFcffMissingReason,
            shareProxyDifference,
            missing: result.missing,
          });
        }
      }
    }
    slices.push(slice);
    console.error(
      `Historical slice ${date}: ${slice.valuationReady}/${slice.registryEligible} candidate valuations`,
    );
  }
  const report = {
    auditVersion: 1,
    capturedAt: new Date().toISOString(),
    asOfDate,
    marketCutoff,
    definitions: {
      periodCoverage:
        'Selected histories as known on asOfDate, not historical-date coverage. Market metrics exist only on the latest period.',
      historicalSlices:
        'Year-end and cutoff dates; registry listing/delisting dates, production resolver and metrics. No stock return outcomes read.',
      valuationReady:
        'Latest annual operating inputs, latest bridge, same-date price/cap/adjustment, and latest report age <= 180 calendar days. Not proof of source accuracy or complete capital claims.',
      excludedVersions:
        'reconstructed excluded by production resolver; conservative does not prove historical vendor vintage.',
      sourceIdentity:
        'Source codes and registry securities are not necessarily unique economic companies. Unregistered codes and missing industry remain explicit.',
      missingHistory:
        'No rows does not mean no required report; listing dates define historical registry denominators.',
    },
    registryCount: stocks.length,
    invalidRegistryCodes: [...registry.keys()].filter((code) => !/^\d{6}\.(SH|SZ|BJ)$/.test(code)),
    sourceCodeCount: sourceCodes.length,
    invalidCodes,
    unregisteredCodes: codes.filter((code) => !registry.has(code)),
    registryWithoutSource: [...registry.keys()].filter((code) => !sourceCodes.includes(code)),
    details,
    periodCoverage,
    slices,
    sliceExclusions,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outputPath,
        asOfDate,
        marketCutoff,
        codes: codes.length,
        slices: slices.map(({ missing: _missing, ...row }) => row),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
