import { prisma } from '#infra/database/prisma.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '../registry/yield-curves.js';

/**
 * 返回所需期限最近可见利率及陈旧性，供下游自行准入。
 *
 * Return the latest visible yield and age per tenor for downstream admission.
 */
export interface GovernmentYieldAvailability {
  termYears: number;
  availableDate: string;
}

/**
 * 为每个所需期限加载最新时点可得的官方利率观测。
 *
 * Load the latest point-in-time observation for each requested maturity.
 */
export async function loadGovernmentYieldAvailability(
  requiredTerms: number[],
  tradeDate: string,
): Promise<GovernmentYieldAvailability[]> {
  const observations = await Promise.all(
    requiredTerms.map((termYears) =>
      prisma.yieldCurvePoint.findFirst({
        where: {
          source: CHINA_TREASURY_CURVE_SOURCE,
          curveCode: CHINA_TREASURY_CURVE_CODE,
          curveType: CHINA_TREASURY_CURVE_TYPE,
          termYears,
          availableDate: { lte: tradeDate },
        },
        orderBy: { availableDate: 'desc' },
        select: { termYears: true, availableDate: true },
      }),
    ),
  );
  return observations.filter((row): row is GovernmentYieldAvailability => row != null);
}
