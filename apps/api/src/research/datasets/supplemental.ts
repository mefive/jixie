import { localDate } from '#market/synchronization/date.js';
import { loadIndicatorVersions } from '#market/fundamentals/indicator-versions.js';
import { getDatabase } from '#infra/database/prisma.js';

/**
 * 指定带日期稳定对象标识的数据查询。
 *
 * Request dated data for a stable governed identifier.
 */
export interface ResearchDatedIdentifierRequestV1 {
  identifier: string;
  start: string;
  end: string;
}

/**
 * 财务指标按当前版本可得日进入研究可见范围。
 *
 * Load financial indicators only from the availability of the actual retained version onward.
 */
export async function loadResearchEquityFundamentals(request: ResearchDatedIdentifierRequestV1) {
  const rows = await loadIndicatorVersions({
    tsCode: request.identifier,
    startDate: request.start,
    endDate: request.end,
  });
  return rows.map((row) => ({
    date: row.availableDate,
    announcement_date: row.annDate,
    availability_quality: row.availabilityQuality,
    observed_at: row.observedAt.toISOString(),
    report_period: row.endDate,
    roe_pct: row.roe,
    roe_waa_pct: row.roeWaa,
    roa_pct: row.roa,
    gross_profit_margin_pct: row.grossprofitMargin,
    net_profit_margin_pct: row.netprofitMargin,
    debt_to_assets_pct: row.debtToAssets,
    revenue_yoy_pct: row.orYoy,
    net_profit_yoy_pct: row.netprofitYoy,
    operating_cash_flow_to_profit: row.ocfToProfit,
  }));
}

/**
 * 读取已实施分红，经济除权日与当前版本捕获可得日分开。
 *
 * Load implemented distributions with separate economic ex-dates and actual captured-version
 * availability.
 */
export async function loadResearchEquityDividends(request: ResearchDatedIdentifierRequestV1) {
  const rows = await getDatabase().dividend.findMany({
    where: {
      tsCode: request.identifier,
      divProc: '实施',
      exDate: { not: null, lte: request.end },
    },
    orderBy: [{ exDate: 'asc' }, { endDate: 'asc' }],
  });
  const evidence = await getDatabase().marketRecordEvidence.findMany({
    where: {
      tableName: 'Dividend',
      businessKey: { in: rows.map((row) => JSON.stringify([row.id])) },
    },
  });
  const byKey = new Map(evidence.map((entry) => [entry.businessKey, entry]));
  const sessions = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1 },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });

  return rows.flatMap((row) => {
    const provenance = byKey.get(JSON.stringify([row.id]));
    if (!provenance) {
      return [];
    }
    const captureDate = localDate(provenance.firstObservedAt);
    const availableDate = sessions.find((session) => session.calDate > captureDate)?.calDate;
    const date = availableDate && availableDate > row.exDate! ? availableDate : row.exDate!;
    if (!availableDate || date < request.start || date > request.end) {
      return [];
    }

    return [
      {
        date,
        ex_date: row.exDate!,
        availability_quality: provenance.availabilityQuality,
        observed_at: provenance.firstObservedAt.toISOString(),
        report_period: row.endDate,
        announcement_date: row.annDate,
        cash_dividend_pre_tax: row.cashDiv,
        cash_dividend_tax_basis: row.cashDivTax,
      },
    ];
  });
}
