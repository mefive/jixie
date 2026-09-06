import { prisma } from '../src/lib/prisma.js';
import { resolveFinancialState } from '../src/fundamentals/resolver.js';
import { calculateFinancialMetrics } from '../src/fundamentals/metrics.js';
import { inspectFinancialAccounting } from '../src/fundamentals/accounting-quality.js';
import { canonicalStockCode } from '../src/market/stock-identity.js';

/** Read-only, bounded-memory audit of exactly the versions selected by the SDK. */
async function main(): Promise<void> {
  const asOfDate = process.argv[2];
  if (!asOfDate || !/^\d{8}$/.test(asOfDate)) {
    throw new Error('Usage: audit-selected-financials.ts YYYYMMDD [tsCode ...]');
  }
  const requested = process.argv.slice(3);
  const codeGroups = requested.length
    ? []
    : await Promise.all([
        prisma.financialIncomeStatement.groupBy({ by: ['tsCode'] }),
        prisma.financialBalanceSheet.groupBy({ by: ['tsCode'] }),
        prisma.financialCashFlowStatement.groupBy({ by: ['tsCode'] }),
      ]);
  const sourceCodes = [
    ...new Set(requested.length ? requested : codeGroups.flat().map((row) => row.tsCode)),
  ].sort();
  const excludedIdentifiers = sourceCodes.filter((code) => !/^\d{6}\.(SH|SZ|BJ)$/.test(code));
  const codes = [
    ...new Set(
      sourceCodes.filter((code) => !excludedIdentifiers.includes(code)).map(canonicalStockCode),
    ),
  ].sort();
  const summary = {
    asOfDate,
    sourceIdentifiers: sourceCodes.length,
    excludedIdentifiers,
    companies: codes.length,
    periods: 0,
    completePeriods: 0,
    selectedStatements: 0,
    invalidMetricValues: 0,
    affectedCompanies: 0,
    issues: {} as Record<string, { count: number; examples: unknown[] }>,
    resolverDiagnostics: {} as Record<string, number>,
  };
  for (let index = 0; index < codes.length; index++) {
    const state = await resolveFinancialState({ tsCode: codes[index], asOfDate });
    summary.periods += state.periods.length;
    summary.completePeriods += state.periods.filter(
      (period) => period.income && period.balanceSheet && period.cashFlow,
    ).length;
    summary.selectedStatements += state.periods.reduce(
      (total, period) =>
        total + [period.income, period.balanceSheet, period.cashFlow].filter(Boolean).length,
      0,
    );
    for (const diagnostic of state.diagnostics) {
      summary.resolverDiagnostics[diagnostic.code] =
        (summary.resolverDiagnostics[diagnostic.code] ?? 0) + 1;
    }
    const issues = state.periods.flatMap(inspectFinancialAccounting);
    if (issues.length) {
      summary.affectedCompanies++;
    }
    for (const issue of issues) {
      const group = summary.issues[issue.diagnostic.code] ?? { count: 0, examples: [] };
      group.count++;
      if (group.examples.length < 3) {
        group.examples.push({
          tsCode: state.tsCode,
          endDate: issue.diagnostic.endDate,
          inputVersions: issue.inputVersions,
        });
      }
      summary.issues[issue.diagnostic.code] = group;
    }
    const metrics = calculateFinancialMetrics(state);
    summary.invalidMetricValues += metrics.periods.reduce(
      (total, period) =>
        total +
        Object.values(period.metrics).filter((metric) =>
          metric.missingReason?.startsWith('accounting_review_required:'),
        ).length,
      0,
    );
    if ((index + 1) % 500 === 0) {
      console.error(`Audited ${index + 1}/${codes.length} companies`);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
