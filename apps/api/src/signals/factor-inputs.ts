import type { FactorDependency, FactorInputSummary } from '@jixie/shared';
import type { PendingFactorObservation } from '../engine/types.js';

/** Reduce final-bar factor reads to statistics plus values for assets affected by the run. */
export function summarizeFactorInputs(
  factors: FactorDependency[],
  asOfDate: string,
  observations: PendingFactorObservation[],
  decisionAssetIds: Iterable<string>,
): FactorInputSummary[] {
  const decisionAssets = new Set(decisionAssetIds);
  const byKey = new Map<string, Map<string, number | null>>();
  for (const observation of observations) {
    const byAsset = byKey.get(observation.key) ?? new Map<string, number | null>();
    byAsset.set(observation.code, observation.value);
    byKey.set(observation.key, byAsset);
  }

  return factors.map((factor) => {
    const observationsByAsset = byKey.get(factor.key) ?? new Map();
    const validValues = [...observationsByAsset.values()].filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
    return {
      factorId: factor.factorId,
      key: factor.key,
      asOfDate,
      observedAssets: observationsByAsset.size,
      validAssets: validValues.length,
      minValue: validValues.length > 0 ? Math.min(...validValues) : null,
      maxValue: validValues.length > 0 ? Math.max(...validValues) : null,
      meanValue:
        validValues.length > 0
          ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length
          : null,
      decisionObservations: [...observationsByAsset]
        .filter(([assetId]) => decisionAssets.has(assetId))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([assetId, value]) => ({ assetId, value })),
    };
  });
}
