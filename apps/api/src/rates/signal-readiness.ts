import type { FactorDependency } from '@jixie/shared';
import { factorV2YieldTerm, isFactorV2FieldKey } from '../factor/factor-v2-fields.js';
import { prisma } from '../lib/prisma.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from './china-treasury-curve.js';

export const GOVERNMENT_YIELD_MAX_STALENESS_DAYS = 14;

export interface GovernmentYieldAvailability {
  termYears: number;
  availableDate: string;
}

/** Resolve the exact curve maturities frozen into active Definition V2 dependencies. */
export function governmentYieldTermsFromDependencies(dependencies: FactorDependency[]): number[] {
  const terms = dependencies.flatMap((dependency) =>
    (dependency.inputs ?? []).flatMap((input) => {
      if (!input.startsWith('rates.cgb.yield.')) {
        return [];
      }
      if (!isFactorV2FieldKey(input)) {
        throw new Error(`Unsupported government yield input ${input}`);
      }
      const term = factorV2YieldTerm(input);
      if (term == null) {
        throw new Error(`Unsupported government yield input ${input}`);
      }
      return [term];
    }),
  );
  return [...new Set(terms)].sort((left, right) => left - right);
}

/** Ensure every required maturity has a point-in-time observation no more than 14 days old. */
export function governmentYieldCurveCoverageReady(
  requiredTerms: number[],
  tradeDate: string,
  observations: GovernmentYieldAvailability[],
): boolean {
  const latestByTerm = new Map<number, string>();
  for (const observation of observations) {
    const current = latestByTerm.get(observation.termYears);
    if (!current || observation.availableDate > current) {
      latestByTerm.set(observation.termYears, observation.availableDate);
    }
  }
  return requiredTerms.every((term) => {
    const availableDate = latestByTerm.get(term);
    return (
      availableDate != null &&
      availableDate <= tradeDate &&
      calendarDaysBetween(availableDate, tradeDate) <= GOVERNMENT_YIELD_MAX_STALENESS_DAYS
    );
  });
}

export async function governmentYieldCurveReady(
  dependencies: FactorDependency[],
  tradeDate: string,
): Promise<boolean> {
  const terms = governmentYieldTermsFromDependencies(dependencies);
  if (terms.length === 0) {
    return true;
  }
  const observations = await Promise.all(
    terms.map((termYears) =>
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
  return governmentYieldCurveCoverageReady(
    terms,
    tradeDate,
    observations.filter((row): row is GovernmentYieldAvailability => row != null),
  );
}

function calendarDaysBetween(start: string, end: string): number {
  const toUtc = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)));
  return Math.floor((toUtc(end) - toUtc(start)) / 86_400_000);
}
