import { describe, expect, it } from 'vitest';
import type { FactorDefinition } from '#engine/factors/execution-port.js';
import { resolveStrategyFactorMetadata } from './metadata.js';

const dependency = {
  factorId: 'factor-1',
  key: 'trend',
  name: 'Trend',
  analysisKind: 'panel' as const,
  codeHash: 'hash',
  approvedReportId: 'report-1',
};

describe('strategy factor metadata', () => {
  it('aggregates composite requirements for engine data loading and persisted lineage', () => {
    const definition: FactorDefinition = {
      id: 'trend',
      kind: 'panel_composite',
      standardization: 'rank',
      assetUniverse: [],
      components: [
        {
          direction: 'positive',
          definition: {
            id: 'a',
            kind: 'asset_series',
            analysisKind: 'panel',
            meta: { window: 21, inputs: ['etf.adjustedClose'] },
          },
        },
        {
          direction: 'negative',
          definition: {
            id: 'b',
            kind: 'asset_series',
            analysisKind: 'panel',
            meta: { window: 61, inputs: ['etf.adjustedClose', 'rates.cgb.yield.10y'] },
          },
        },
      ],
    };
    const resolved = resolveStrategyFactorMetadata([{ key: 'trend' }], [dependency], [definition]);
    expect(resolved.modules[0].assetSeries).toEqual({
      window: 61,
      inputs: ['etf.adjustedClose', 'rates.cgb.yield.10y'],
    });
    expect(resolved.factors[0]).toEqual({
      ...dependency,
      inputs: ['etf.adjustedClose', 'rates.cgb.yield.10y'],
    });
    expect(dependency).not.toHaveProperty('inputs');
  });

  it('rejects research-only fields inside composite components', () => {
    expect(() =>
      resolveStrategyFactorMetadata(
        [{ key: 'trend' }],
        [dependency],
        [
          {
            id: 'trend',
            kind: 'panel_composite',
            standardization: 'rank',
            assetUniverse: [],
            components: [
              {
                direction: 'positive',
                definition: {
                  id: 'a',
                  kind: 'asset_series',
                  analysisKind: 'panel',
                  meta: { window: 21, inputs: ['commodity.warehouseReceipt.volume'] },
                },
              },
            ],
          },
        ],
      ),
    ).toThrow(expect.objectContaining({ reason: 'research_only_inputs_unavailable' }));
  });

  it('fails closed when a dependency has no runtime definition', () => {
    expect(() => resolveStrategyFactorMetadata([{ key: 'trend' }], [dependency], [])).toThrow(
      'Missing factor metadata',
    );
  });
});
