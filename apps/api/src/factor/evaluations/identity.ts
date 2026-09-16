import type {
  FactorAnalysisSpec,
  FactorResearchIntentV1,
  FactorResearchSpecV1,
} from '@jixie/shared';
import { canonicalJson, sha256 } from '../sources/fingerprint.js';

export function factorVariantKey(
  spec: FactorAnalysisSpec | FactorResearchSpecV1,
  factorCodeHash: string,
  dataRevision: string | null = null,
): string {
  return sha256(canonicalJson({ spec, factorCodeHash, dataRevision }));
}

export function factorTestKey(
  spec: FactorAnalysisSpec | FactorResearchSpecV1,
  factorCodeHash: string,
  intent: FactorResearchIntentV1,
): string {
  const claim = {
    mode: intent.mode,
    expectedDirection: intent.expectedDirection,
    primaryCriterion: intent.primaryCriterion,
  };

  return sha256(canonicalJson({ spec, factorCodeHash, claim }));
}
