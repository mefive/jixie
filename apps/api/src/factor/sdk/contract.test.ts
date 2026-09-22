import type { CrossSectionalFactorRuntime, PanelFactorRuntime } from '../runtime/contract.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import ts from 'typescript';
import { buildFactorSdkDts, type FactorBar } from '@jixie/shared';
import type {
  AssetFactorV2,
  CustomFactor,
  DefineFactor,
  DefineFactorV2,
  FactorBar as PublicFactorBar,
  FactorCtx,
  TimeSeriesFactorCtxV2,
} from '@jixie/shared/sdk/factor/contract';

import {
  CrossSectionalFactorContext,
  AssetFactorContext,
  defineFactor,
  defineFactorV2,
} from './typescript.js';

describe('Factor authoring contracts', () => {
  it('checks SDK factories and host metadata against the generated public types', () => {
    expectTypeOf<typeof defineFactor>().toEqualTypeOf<DefineFactor>();
    expectTypeOf<typeof defineFactorV2>().toEqualTypeOf<DefineFactorV2>();
    expectTypeOf<CrossSectionalFactorContext>().toExtend<FactorCtx>();
    expectTypeOf<Pick<CrossSectionalFactorContext, keyof FactorCtx>>().toEqualTypeOf<FactorCtx>();
    expectTypeOf<AssetFactorContext>().toExtend<TimeSeriesFactorCtxV2>();
    expectTypeOf<
      Pick<AssetFactorContext, keyof TimeSeriesFactorCtxV2>
    >().toEqualTypeOf<TimeSeriesFactorCtxV2>();
    expectTypeOf<Readonly<FactorBar>>().toEqualTypeOf<PublicFactorBar>();
    expectTypeOf<Omit<CrossSectionalFactorRuntime['metadata'], 'analysisKind'>>().toEqualTypeOf<
      Omit<CustomFactor, 'compute'>
    >();
    expectTypeOf<Omit<PanelFactorRuntime['metadata'], 'inputs'>>().toExtend<
      Omit<AssetFactorV2, 'compute' | 'inputs'>
    >();
  });

  for (const locale of ['zh', 'en'] as const) {
    it(`preserves cross-sectional history overloads in the ${locale} editor`, () => {
      const diagnostics = checkSource(
        buildFactorSdkDts(locale) +
          `
        export default defineFactor({
          name: 'window', window: 20, minCoverage: 0.8,
          compute(bar, ctx) {
            const dates: string[] = ctx.history(20, 'date');
            const closes: number[] = ctx.history(20);
            const turnover: (number | null)[] = ctx.history(20, 'turnoverRateF');
            const market: (number | null)[] = ctx.history(20, 'marketClose');
            const earnings: number | null = bar.peTtm;
            return dates.length && turnover.length && market.length ? closes[0] : earnings;
          }
        });
      `,
      );
      expect(diagnostics).toEqual([]);
      expect(buildFactorSdkDts(locale)).toContain(locale === 'zh' ? '市盈率 TTM' : 'P/E (TTM)');
    });

    for (const analysisKind of ['time_series', 'panel']) {
      it(`preserves ${analysisKind} authoring in the ${locale} editor`, () => {
        expect(
          checkSource(
            buildFactorSdkDts(locale) +
              `
          export default defineFactorV2({
            version: 2, name: 'trend', analysisKind: '${analysisKind}',
            outputScope: 'asset', frequency: 'daily', inputs: ['etf.adjustedClose'],
            targetAssetClasses: ['equity'], window: 20,
            compute(ctx) {
              const value = ctx.value('etf.adjustedClose');
              const prior = ctx.lag('etf.adjustedClose', 19);
              return value == null || prior == null ? null : value / prior - 1;
            }
          });
        `,
          ),
        ).toEqual([]);
      });
    }
  }

  it('retains readonly bars, nullable values and the existing TS field surface', () => {
    const source =
      buildFactorSdkDts('en') +
      `
      defineFactor({ name: 'invalid', compute(bar, ctx) {
        bar.pe = 3;
        const value: number = bar.peTtm;
        ctx.history(20, 'missing');
        return value;
      }});
      const field: FactorV2Field = 'commodity.futures.annualizedLogCarry';
    `;
    expect(
      checkSource(source)
        .map((diagnostic) => diagnostic.code)
        .sort(),
    ).toEqual([2540, 2322, 2769, 2322].sort());
  });
});

function checkSource(source: string) {
  const path = '/factor-authoring-contract.ts';
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === path
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([path], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}
