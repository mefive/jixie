import { CHINA_TREASURY_TERMS } from '../registry/yield-curves.js';
import { CHINABOND_PUBLIC_CURVES } from './chinabond-credit-curves.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';
import {
  assignCurveAvailableDates,
  type ChinaTreasuryCurveClient,
} from './china-treasury-curve.js';
import {
  CHINABOND_PUBLIC_CURVE_SOURCE,
  CHINABOND_PUBLIC_CURVE_TYPE,
  type ChinaBondCreditCurveClient,
} from './chinabond-credit-curves.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_NAME,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '../registry/yield-curves.js';

/**
 * 曲线合法期限独立入库，缺期限留在覆盖和计算资格中。
 *
 * Persist valid curve terms independently; missing tenors remain coverage and eligibility gaps.
 */
export async function prepareCurvePartition(
  treasury: ChinaTreasuryCurveClient,
  credit: ChinaBondCreditCurveClient,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const calendar = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: partition.startDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const errors: string[] = [];
  const onRejected = (message: string) => errors.push(message);
  const points =
    partition.dataset === 'treasury-curves'
      ? (await treasury.fetchRange(partition.startDate, partition.endDate, true, onRejected)).map(
          (point) => ({
            ...point,
            source: CHINA_TREASURY_CURVE_SOURCE,
            curveCode: CHINA_TREASURY_CURVE_CODE,
            curveName: CHINA_TREASURY_CURVE_NAME,
            curveType: CHINA_TREASURY_CURVE_TYPE,
          }),
        )
      : (await credit.fetchRange(partition.startDate, partition.endDate, true, onRejected)).map(
          (point) => ({
            ...point,
            source: CHINABOND_PUBLIC_CURVE_SOURCE,
            curveType: CHINABOND_PUBLIC_CURVE_TYPE,
          }),
        );
  const records = points.flatMap((point) => {
    try {
      if (
        point.tradeDate < partition.startDate ||
        point.tradeDate > partition.endDate ||
        !Number.isFinite(point.yieldPct) ||
        !Number.isFinite(point.termYears) ||
        point.termYears <= 0
      ) {
        throw new Error('Invalid curve point');
      }
      const available = assignCurveAvailableDates(
        [point],
        calendar.map((entry) => entry.calDate),
      )[0];

      return [
        {
          values: { ...available, retrievedAt: fetchedAt },
          availableDate: available.availableDate,
          availabilityQuality: 'source_contract' as const,
        },
      ];
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  });
  if (!points.length) {
    errors.push(`${partition.dataset}: unexplained empty curve response`);
  }

  const gaps: string[] = [];
  const terms =
    partition.dataset === 'treasury-curves'
      ? [...CHINA_TREASURY_TERMS]
      : [0.25, 0.5, 1, 3, 5, 7, 10, 30];
  const curves =
    partition.dataset === 'treasury-curves'
      ? [CHINA_TREASURY_CURVE_CODE]
      : CHINABOND_PUBLIC_CURVES.map((curve) => curve.curveCode);
  const sessions = await getDatabase().tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gte: partition.startDate, lte: partition.endDate },
    },
    select: { calDate: true },
  });
  if (!sessions.length) {
    gaps.push('Source session calendar is unavailable');
  }
  for (const session of sessions) {
    for (const curve of curves) {
      if (
        terms.some(
          (term) =>
            !records.some(
              (record) =>
                record.values.tradeDate === session.calDate &&
                record.values.curveCode === curve &&
                record.values.termYears === term,
            ),
        )
      ) {
        gaps.push(`${curve}/${session.calDate}: incomplete published maturities`);
      }
    }
  }

  return {
    tables: [{ table: 'YieldCurvePoint', records }],
    status: errors.length ? 'error' : gaps.length ? 'partial' : 'complete',
    evidence: { sourcePoints: points.length, boundedResponse: true },
    gaps,
    errors,
    observedDates: records.map((record) => record.values.tradeDate),
  };
}
