import type { UniverseSpecV1 } from '@jixie/shared';
import { researchUniverseMeasureById } from '../catalog/capabilities.js';

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
    throw new Error(`Invalid universe spec: unknown measure ${unknown.join(', ')}`);
  }
  const duplicateSelect = spec.select.find(
    (item, index) =>
      spec.select.findIndex((candidate) => candidate.measure === item.measure) !== index,
  );
  if (duplicateSelect) {
    throw new Error(`Invalid universe spec: duplicate selected measure ${duplicateSelect.measure}`);
  }
  if (spec.predicates.some((predicate) => typeof predicate.value !== 'number')) {
    throw new Error('Invalid universe spec: V1 universe measures require numeric predicate values');
  }
}
