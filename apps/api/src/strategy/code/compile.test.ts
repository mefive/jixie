import { describe, expect, it } from 'vitest';
import { compileStrategy } from './compile.js';
import type { BarContext } from '../../engine/types.js';

// A canonical hand-written strategy: MA20 breakout on one name. Import-free — `defineStrategy` is injected.
const MA_CROSS = `
export default defineStrategy({
  name: 'MA20 突破',
  watch: ['600519.SH'],
  onBar(ctx) {
    const code = '600519.SH';
    const px = ctx.price(code);
    const win = ctx.history(code, 'close', 20);
    if (px == null || win.length < 20) return;
    const ma = win.reduce((a, b) => a + b, 0) / win.length;
    if (px > ma && ctx.shares(code) === 0) ctx.order(code, 100);
    else if (px < ma && ctx.shares(code) > 0) ctx.exit(code);
  },
});
`;

/** A mock ctx that records orders, with knobs for the few primitives MA_CROSS reads. */
function mockCtx(o: { px: number; window: number[]; held: number }) {
  const orders: { code: string; shares: number }[] = [];
  const exits: string[] = [];
  const ctx = {
    price: () => o.px,
    history: () => o.window,
    shares: () => o.held,
    order: (code: string, shares: number) => orders.push({ code, shares }),
    exit: (code: string) => exits.push(code),
  } as unknown as BarContext;
  return { ctx, orders, exits };
}

const win20 = Array.from({ length: 20 }, () => 100); // MA = 100

describe('compileStrategy', () => {
  it('compiles TS source → a runnable Strategy', async () => {
    const s = await compileStrategy(MA_CROSS);
    expect(s.name).toBe('MA20 突破');
    expect(s.watch).toEqual(['600519.SH']);
    expect(typeof s.onBar).toBe('function');
  });

  it('the compiled onBar buys above the MA when flat', async () => {
    const s = await compileStrategy(MA_CROSS);
    const { ctx, orders } = mockCtx({ px: 110, window: win20, held: 0 });
    await s.onBar(ctx);
    expect(orders).toEqual([{ code: '600519.SH', shares: 100 }]);
  });

  it('exits below the MA when held', async () => {
    const s = await compileStrategy(MA_CROSS);
    const { ctx, exits } = mockCtx({ px: 90, window: win20, held: 100 });
    await s.onBar(ctx);
    expect(exits).toEqual(['600519.SH']);
  });

  it('does nothing flat-and-below or held-and-above (命中即停的两侧)', async () => {
    const s = await compileStrategy(MA_CROSS);
    const flatBelow = mockCtx({ px: 90, window: win20, held: 0 });
    await s.onBar(flatBelow.ctx);
    expect(flatBelow.orders).toEqual([]);
    const heldAbove = mockCtx({ px: 110, window: win20, held: 100 });
    await s.onBar(heldAbove.ctx);
    expect(heldAbove.exits).toEqual([]);
  });

  it('rejects a module with no default export', async () => {
    await expect(compileStrategy('const x = 1;')).rejects.toThrow('export default');
  });

  it('blocks importing external modules (used import → require fires → throws)', async () => {
    await expect(
      compileStrategy(
        `import { readFileSync } from 'fs';\nexport default defineStrategy({ onBar() { readFileSync('/etc/passwd'); } });`,
      ),
    ).rejects.toThrow('cannot import');
  });

  it('surfaces TS syntax errors as a compile error', async () => {
    await expect(compileStrategy('export default defineStrategy({ onBar( {} );')).rejects.toThrow(
      'compilation failed',
    );
  });
});
