import { describe, expect, expectTypeOf, it } from 'vitest';
import { CTX_PROP_NAMES, SDK_ENTRIES, type SdkEntryName } from '@jixie/shared';
import type { StrategyCtx, Universe } from './sdk.js';
import type { BarRow } from '../../engine/types.js';

/**
 * Drift guard between the SDK registry (@jixie/shared sdk-reference.ts — the single source that
 * generates the Monaco dts, the doc page, and the codegen prompt's surface lists) and the runtime
 * types here. Both directions are checked AT COMPILE TIME (tsc --noEmit / vitest --typecheck):
 *   - ghost entries: every registry name must be a real member of the runtime type;
 *   - missing entries: every runtime member must be registered (or explicitly listed as internal).
 * Add a method to StrategyCtx without registering it and typecheck fails — that's the point.
 */

// Members deliberately NOT in the registry: the readonly props are emitted separately (CTX_PROP_NAMES),
// and loadCrossSection is the engine primitive behind universe() — the dts hides it from user code.
type CtxUndocumented = (typeof CTX_PROP_NAMES)[number] | 'loadCrossSection';

// Universe.length is emitted as a hardcoded readonly prop in the dts, not a registry entry.
type UniverseUndocumented = 'length';

describe('sdk-reference registry ↔ runtime SDK types stay in sync', () => {
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

  it('entry names are unique within each interface (they are doc anchors)', () => {
    const seen = new Set<string>();
    for (const entry of SDK_ENTRIES) {
      const key = `${entry.iface}.${entry.name}`;
      expect(seen.has(key), `duplicate entry ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
