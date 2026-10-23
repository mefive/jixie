import { getDatabase } from '#infra/database/prisma.js';

export interface IndicatorVersionsInput {
  tsCode?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * 公开日期与当前版本可得日期不同；最新值回填只能从实际捕获时点使用。
 *
 * Announcement and current-version availability differ; latest-only backfills are usable only from
 * capture time.
 */
export async function loadIndicatorVersions(input: IndicatorVersionsInput = {}) {
  return getDatabase().finaIndicatorVersion.findMany({
    where: {
      availabilityQuality: { not: 'unknown' },
      ...(input.tsCode ? { tsCode: input.tsCode } : {}),
      ...(input.startDate || input.endDate
        ? {
            availableDate: {
              ...(input.startDate ? { gte: input.startDate } : {}),
              ...(input.endDate ? { lte: input.endDate } : {}),
            },
          }
        : {}),
    },
    orderBy: [
      { availableDate: 'asc' },
      { annDate: 'asc' },
      { endDate: 'asc' },
      { observedAt: 'asc' },
    ],
  });
}
