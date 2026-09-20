import { describe, expect, expectTypeOf, it } from 'vitest';
import { CTX_PROP_NAMES, SDK_ENTRIES, TIMEFRAME_METHODS, type SdkEntryName } from '@jixie/shared';
import type {
  DefineStrategy,
  StrategyCtx,
  TimeframeSeries,
  Universe,
} from '@jixie/shared/sdk/strategy/contract';
import type { BarRow, EngineContext } from '#engine/types.js';
import { defineStrategy, Universe as UniverseImplementation } from './typescript.js';

/**
 * Drift guard between the SDK registry (@jixie/shared sdk/strategy/reference.ts — the single source that
 * generates Monaco declarations, implementation types, docs and Agent reference) and its adapters.
 * Implementation helpers consume generated signatures directly; these compile-time assertions
 * also check primitive compatibility and that no internal simulation member becomes public.
 */

// Readonly properties are emitted separately from callable registry entries.
type CtxUndocumented = (typeof CTX_PROP_NAMES)[number];

// Universe.length is emitted as a hardcoded readonly prop in the dts, not a registry entry.
type UniverseUndocumented = 'length';

describe('sdk-reference registry ↔ runtime SDK types stay in sync', () => {
  it('implements the public factory and selection signatures', () => {
    expectTypeOf<typeof defineStrategy>().toExtend<DefineStrategy>();
    expectTypeOf<UniverseImplementation>().toExtend<Universe>();
  });
  it('keeps simulation primitives out of the public authoring context', () => {
    expectTypeOf<
      Extract<keyof StrategyCtx, 'loadCrossSection' | 'resampledBars'>
    >().toEqualTypeOf<never>();
  });

  it('checks complete public primitive signatures against the engine adapter', () => {
    type PublicPrimitives = Pick<StrategyCtx, Extract<keyof StrategyCtx, keyof EngineContext>>;
    expectTypeOf<EngineContext>().toExtend<PublicPrimitives>();
    expectTypeOf<Parameters<StrategyCtx['orderTargetPercent']>>().toEqualTypeOf<
      [code: string, weight: number]
    >();
    expectTypeOf<ReturnType<StrategyCtx['history']>>().toEqualTypeOf<number[]>();
  });

  it('StrategyCtx: no ghost entries, no unregistered members', () => {
    expectTypeOf<SdkEntryName<'StrategyCtx'>>().toExtend<keyof StrategyCtx>();
    expectTypeOf<
      Exclude<keyof StrategyCtx, SdkEntryName<'StrategyCtx'> | CtxUndocumented>
    >().toEqualTypeOf<never>();
  });

  it('Universe: no ghost entries, no unregistered members', () => {
    expectTypeOf<SdkEntryName<'Universe'>>().toExtend<keyof Universe>();
    expectTypeOf<
      Exclude<keyof Universe, SdkEntryName<'Universe'> | UniverseUndocumented>
    >().toEqualTypeOf<never>();
  });

  it('BarRow: registry fields and runtime fields match exactly', () => {
    expectTypeOf<SdkEntryName<'BarRow'>>().toExtend<keyof BarRow>();
    expectTypeOf<Exclude<keyof BarRow, SdkEntryName<'BarRow'>>>().toEqualTypeOf<never>();
  });

  it('TimeframeSeries: static reference methods and runtime methods match exactly', () => {
    type ReferencedMethod = (typeof TIMEFRAME_METHODS)[number]['name'];
    expectTypeOf<ReferencedMethod>().toExtend<keyof TimeframeSeries>();
    expectTypeOf<Exclude<keyof TimeframeSeries, ReferencedMethod>>().toEqualTypeOf<never>();
  });

  it('categorical defaults widen on ctx so scan overrides remain type-correct', () => {
    type SizingCtx = StrategyCtx<{ sizing: 'equal'; riskPct: 0.01 }>;
    expectTypeOf<SizingCtx['params']['sizing']>().toEqualTypeOf<string>();
    expectTypeOf<SizingCtx['params']['riskPct']>().toEqualTypeOf<number>();
  });

  it('entry names are unique within each interface (they are doc anchors)', () => {
    const seen = new Set<string>();
    for (const entry of SDK_ENTRIES) {
      const key = `${entry.iface}.${entry.name}`;
      expect(seen.has(key), `duplicate entry ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
