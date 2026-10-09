import { describe, expect, it } from 'vitest';
import { FactorRuntime } from '../factor-runtime.js';

describe('TypeScript Factor definition factory injection', () => {
  it('keeps the cross-sectional factory in evaluation and callback scope', async () => {
    const runtime = await FactorRuntime.start({
      language: 'typescript',
      analysisKind: 'cross_sectional',
      code: `
        function assertFactoryScope() {
          if (typeof defineFactor !== 'function' || typeof defineFactorV2 !== 'undefined') {
            throw new Error('unexpected cross-sectional factory scope');
          }
          if ('defineFactor' in globalThis || 'defineFactorV2' in globalThis) {
            throw new Error('definition factories must not be registered globally');
          }
        }
        assertFactoryScope();
        export default defineFactor({
          name: 'local cross-sectional factory',
          compute(bar) {
            assertFactoryScope();
            return bar.close;
          },
        });
      `,
    });

    try {
      expect(runtime.metadata.name).toBe('local cross-sectional factory');
      await expect(runtime.execute({ items: [{ bar: { close: 10 } as never }] })).resolves.toEqual([
        10,
      ]);
      await expect(runtime.execute({ items: [{ bar: { close: 20 } as never }] })).resolves.toEqual([
        20,
      ]);
    } finally {
      runtime.close();
    }
  });

  it.each(['time_series', 'panel'] as const)(
    'keeps the %s factory in evaluation and callback scope',
    async (analysisKind) => {
      const runtime = await FactorRuntime.start({
        language: 'typescript',
        analysisKind,
        code: `
          function assertFactoryScope() {
            if (typeof defineFactorV2 !== 'function' || typeof defineFactor !== 'undefined') {
              throw new Error('unexpected asset factory scope');
            }
            if ('defineFactor' in globalThis || 'defineFactorV2' in globalThis) {
              throw new Error('definition factories must not be registered globally');
            }
          }
          assertFactoryScope();
          export default defineFactorV2({
            version: 2,
            name: 'local asset factory',
            analysisKind: '${analysisKind}',
            outputScope: 'asset',
            frequency: 'daily',
            inputs: ['etf.adjustedClose'],
            targetAssetClasses: ['equity'],
            window: 2,
            compute(ctx) {
              assertFactoryScope();
              return ctx.value('etf.adjustedClose');
            },
          });
        `,
      });

      try {
        expect(runtime.metadata).toMatchObject({ name: 'local asset factory', analysisKind });
        await expect(
          runtime.execute({ fields: { 'etf.adjustedClose': [10, 20] }, indexes: [1, 0] }),
        ).resolves.toEqual([20, 10]);
        await expect(
          runtime.execute({ fields: { 'etf.adjustedClose': [30, 40] }, indexes: [1] }),
        ).resolves.toEqual([40]);
      } finally {
        runtime.close();
      }
    },
  );

  it('keeps the injected factory independent of user-assigned global properties', async () => {
    const runtime = await FactorRuntime.start({
      language: 'typescript',
      analysisKind: 'cross_sectional',
      code: `
        globalThis.defineFactor = () => { throw new Error('user global factory called'); };
        export default defineFactor({
          name: 'independent factory',
          compute(bar) {
            const nested = defineFactor({ name: 'nested', compute: () => bar.close });
            return nested.compute();
          },
        });
      `,
    });

    try {
      await expect(runtime.execute({ items: [{ bar: { close: 10 } as never }] })).resolves.toEqual([
        10,
      ]);
    } finally {
      runtime.close();
    }
  });

  it.each([
    { analysisKind: 'cross_sectional', factoryName: 'defineFactor' },
    { analysisKind: 'time_series', factoryName: 'defineFactorV2' },
    { analysisKind: 'panel', factoryName: 'defineFactorV2' },
  ] as const)(
    'rejects global factory access for $analysisKind',
    async ({ analysisKind, factoryName }) => {
      await expect(
        FactorRuntime.start({
          language: 'typescript',
          analysisKind,
          code: `export default globalThis.${factoryName}({});`,
        }),
      ).rejects.toThrow(/is not a function/);
    },
  );
});
