import type { FactorCompositeDefinitionV1 } from '@jixie/shared';
import type { Series } from './analysis.js';

export type FactorAnalysisRuntimeSource =
  | { kind: 'single'; code: string; label: string }
  | {
      kind: 'composite';
      label: string;
      definition: FactorCompositeDefinitionV1;
      components: Array<{
        factor: string;
        code: string;
        label: string;
        direction: 'positive' | 'negative';
      }>;
    };

export interface CompositeSeriesInput {
  factor: string;
  series: Series;
}

/** Combine factor exposures date by date. Every component is standardized on the common stock
 * intersection before directions and equal weights are applied, so missingness cannot silently give
 * different stocks different effective models. */
export function combineFactorSeries(
  inputs: CompositeSeriesInput[],
  definition: FactorCompositeDefinitionV1,
): Series {
  const inputByFactor = new Map(inputs.map((input) => [input.factor, input.series]));
  const dateSets = definition.components.map(
    (component) => new Set(inputByFactor.get(component.factor)?.keys() ?? []),
  );
  const dates = [...(dateSets[0] ?? [])].filter((date) =>
    dateSets.every((dateSet) => dateSet.has(date)),
  );
  const combined: Series = new Map();

  for (const date of dates) {
    const valueMaps = definition.components.map(
      (component) =>
        new Map(
          (inputByFactor.get(component.factor)?.get(date) ?? []).map((row) => [
            row.tsCode,
            row.value,
          ]),
        ),
    );
    const codes = [...(valueMaps[0]?.keys() ?? [])]
      .filter((code) => valueMaps.every((values) => values.has(code)))
      .sort();
    if (codes.length === 0) {
      continue;
    }

    const standardized = valueMaps.map((values) => {
      const raw = codes.map((code) => values.get(code)!);
      return definition.standardization === 'rank' ? centeredRankPercentiles(raw) : zscores(raw);
    });
    const rows = codes.map((tsCode, codeIndex) => {
      const value = definition.components.reduce((sum, component, componentIndex) => {
        const direction = component.direction === 'positive' ? 1 : -1;
        return sum + standardized[componentIndex][codeIndex] * direction;
      }, 0);
      return { tsCode, value: value / definition.components.length };
    });
    combined.set(date, rows);
  }

  return combined;
}

function centeredRankPercentiles(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length).fill(0);
  let cursor = 0;
  while (cursor < order.length) {
    let last = cursor;
    while (last + 1 < order.length && order[last + 1].value === order[cursor].value) {
      last++;
    }
    const averageRank = (cursor + last) / 2;
    for (let index = cursor; index <= last; index++) {
      ranks[order[index].index] = averageRank;
    }
    cursor = last + 1;
  }
  if (values.length === 1) {
    return [0];
  }
  return ranks.map((rank) => rank / (values.length - 1) - 0.5);
}

function zscores(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation === 0
    ? values.map(() => 0)
    : values.map((value) => (value - mean) / standardDeviation);
}
