import { prisma } from '#infra/database/prisma.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '../registry/yield-curves.js';

export interface GovernmentYieldAvailability {
  termYears: number;
  availableDate: string;
}

/** Load the latest point-in-time observation for each requested maturity. */
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
