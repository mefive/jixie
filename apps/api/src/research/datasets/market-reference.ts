import { getDatabase } from '#infra/database/prisma.js';

/**
 * 指定受控参考数据的身份和日期范围。
 *
 * Request a governed reference dataset by identity and date range.
 */
export interface ResearchReferenceDatasetRequestV1 {
  identifier: string;
  start: string;
  end: string;
}

/**
 * 保留供应商官方指数估值方法，不从成分数据自行重建。
 *
 * Preserve the provider's official index-level methodology instead of reconstructing valuations.
 */
export async function loadResearchIndexValuation(request: ResearchReferenceDatasetRequestV1) {
  const rows = await getDatabase().indexDailyBasic.findMany({
    where: {
      tsCode: request.identifier,
      tradeDate: { gte: request.start, lte: request.end },
    },
    orderBy: { tradeDate: 'asc' },
  });
  return rows.map((row) => ({
    date: row.tradeDate,
    total_mv_cny: row.totalMv,
    float_mv_cny: row.floatMv,
    total_share: row.totalShare,
    float_share: row.floatShare,
    free_share: row.freeShare,
    turnover_rate_pct: row.turnoverRate,
    turnover_rate_free_float_pct: row.turnoverRateF,
    pe: row.pe,
    pe_ttm: row.peTtm,
    pb: row.pb,
  }));
}
