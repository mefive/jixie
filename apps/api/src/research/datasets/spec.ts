import type { UniverseSpecV1 } from '@jixie/shared';
import { researchUniverseMeasureById } from '../catalog/capabilities.js';
import { ResearchError } from '../errors.js';

export function validateUniverseSpec(spec: UniverseSpecV1): void {
  const referenced = [
    ...spec.predicates.map((predicate) => predicate.measure),
    ...spec.select.map((measure) => measure.measure),
    ...(spec.sort ? [spec.sort.measure] : []),
  ];
  const unknown = [...new Set(referenced)].filter(
    (measure) => !researchUniverseMeasureById.has(measure),
  );
  if (unknown.length > 0) {
    throw new ResearchError('universe_unknown_measure', {
      params: { measures: unknown.join(', ') },
    });
  }
  const duplicateSelect = spec.select.find(
    (item, index) =>
      spec.select.findIndex((candidate) => candidate.measure === item.measure) !== index,
  );
  if (duplicateSelect) {
    throw new ResearchError('universe_duplicate_measure', {
      params: { measure: duplicateSelect.measure },
    });
  }
  if (spec.predicates.some((predicate) => typeof predicate.value !== 'number')) {
    throw new ResearchError('universe_numeric_predicate');
  }
}
