import type { FactorAnalysisSpec, FactorResearchSpecV1 } from '@jixie/shared';
import { canonicalJson, sha256 } from '../sources/fingerprint.js';

export function factorVariantKey(
  spec: FactorAnalysisSpec | FactorResearchSpecV1,
  factorCodeHash: string,
  dataRevision: string | null = null,
): string {
  return sha256(canonicalJson({ spec, factorCodeHash, dataRevision }));
}
