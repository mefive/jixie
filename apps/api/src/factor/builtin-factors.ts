import type { FactorKind, FactorMeta } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

/**
 * Built-in preset factors as CODE (design: factor-to-strategy.md Step 1b — code-first carried through on the factor side).
 * The source of truth is this file (git); seedBuiltinFactors materializes each preset into a
 * read-only Factor row so analysis runs presets and user factors through ONE compile+compute path.
 * Pinned invariants:
 *   - keys are stable slugs (ep/mom/…) — FactorReport cache keys and ?factor= URLs depend on them;
 *   - preset rows use the BUILTIN_USER_ID sentinel (no real user) and are rejected by edit/delete;
 *   - seeding is idempotent; a code change here invalidates every user's cached reports of that key.
 * Price presets duplicate a small date-gap helper in each module — factor code is import-free by
 * design (the sandbox has no require), so self-containment beats sharing.
 */
export const BUILTIN_USER_ID = 'builtin';

export interface BuiltinFactorDef {
  key: string; // stable slug — never rename (cache keys / URLs)
  label: string;
  kind: FactorKind;
  code: string; // defineFactor TS module, materialized into the Factor row
}

const MOMENTUM_CODE = `// Preset: momentum — 60-day return, skipping the most recent 5 days (avoids short-term reversal contamination).
// A calendar gap > 30 days between adjacent trading days in the window (~ suspended for over a month) marks the series discontinuous; drop that period.
export default defineFactor({
  name: '动量(60日,跳5)',
  window: 61,
  compute(bar, ctx) {
    const closes = ctx.history(61);
    if (closes.length < 61) {
      return null;
    }
    const dates = ctx.history(61, 'date');
    for (let i = 1; i < dates.length; i++) {
      if (gapDays(dates[i - 1], dates[i]) > 30) {
        return null;
      }
    }
    const recent = closes[55]; // day - 5
    const past = closes[0]; // day - 60
    if (!recent || !past) {
      return null;
    }
    return recent / past - 1;
  },
});

// Calendar days between two YYYYMMDD dates.
function gapDays(a: string, b: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6)) / 86400000;
  return day(b) - day(a);
}
`;

const REVERSAL_CODE = `// Preset: short-term reversal — 5-day return (A-share market is retail-dominated; this factor's IC is usually negative = buy the biggest losers).
export default defineFactor({
  name: '反转(5日)',
  window: 6,
  compute(bar, ctx) {
    const closes = ctx.history(6);
    if (closes.length < 6) {
      return null;
    }
    const dates = ctx.history(6, 'date');
    for (let i = 1; i < dates.length; i++) {
      if (gapDays(dates[i - 1], dates[i]) > 30) {
        return null;
      }
    }
    const past = closes[0];
    if (!past) {
      return null;
    }
    return closes[5] / past - 1;
  },
});

// Calendar days between two YYYYMMDD dates.
function gapDays(a: string, b: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6)) / 86400000;
  return day(b) - day(a);
}
`;

const VOLATILITY_CODE = `// Preset: realized volatility — standard deviation of the last 20 daily returns (low-volatility anomaly; IC is usually negative = lower vol is better).
export default defineFactor({
  name: '波动率(20日)',
  window: 21,
  compute(bar, ctx) {
    const closes = ctx.history(21);
    if (closes.length < 21) {
      return null;
    }
    const dates = ctx.history(21, 'date');
    for (let i = 1; i < dates.length; i++) {
      if (gapDays(dates[i - 1], dates[i]) > 30) {
        return null;
      }
    }
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1];
      if (!prev) {
        return null;
      }
      returns.push(closes[i] / prev - 1);
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  },
});

// Calendar days between two YYYYMMDD dates.
function gapDays(a: string, b: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6)) / 86400000;
  return day(b) - day(a);
}
`;

export const BUILTIN_FACTORS: BuiltinFactorDef[] = [
  { key: 'mom', label: '动量(60日,跳5)', kind: 'price', code: MOMENTUM_CODE },
  { key: 'rev', label: '反转(5日)', kind: 'price', code: REVERSAL_CODE },
  { key: 'vol', label: '波动率(20日)', kind: 'price', code: VOLATILITY_CODE },
  {
    key: 'ep',
    label: '盈利收益率(1/PE_TTM)',
    kind: 'fundamental',
    code: `// Preset: earnings yield — reciprocal of PE_TTM (cheaper = larger value); loss-making stocks (PE <= 0) are dropped.
export default defineFactor({
  name: '盈利收益率(1/PE_TTM)',
  compute: (bar) => (bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null),
});
`,
  },
  {
    key: 'bp',
    label: '账面市值比(1/PB)',
    kind: 'fundamental',
    code: `// Preset: book-to-market — reciprocal of PB (classic value factor).
export default defineFactor({
  name: '账面市值比(1/PB)',
  compute: (bar) => (bar.pb && bar.pb > 0 ? 1 / bar.pb : null),
});
`,
  },
  {
    key: 'dv',
    label: '股息率(%)',
    kind: 'fundamental',
    code: `// Preset: dividend yield — raw dvRatio value from daily_basic (%).
export default defineFactor({
  name: '股息率(%)',
  compute: (bar) => bar.dvRatio,
});
`,
  },
  {
    key: 'size',
    label: '规模(ln总市值)',
    kind: 'fundamental',
    code: `// Preset: size — ln(total market cap). Direction is revealed by IC (A-share long-run small-cap premium = negative IC).
export default defineFactor({
  name: '规模(ln总市值)',
  compute: (bar) => (bar.totalMv && bar.totalMv > 0 ? Math.log(bar.totalMv) : null),
});
`,
  },
  {
    key: 'mf_net_main',
    label: '主力净额(万元)',
    kind: 'moneyflow',
    code: `// Preset: main-force net amount — (large + extra-large orders) buy minus sell, in 10k yuan. Flow semantics: null when no data that day, never carried forward.
export default defineFactor({
  name: '主力净额(万元)',
  compute: (bar) => bar.netMain,
});
`,
  },
  {
    key: 'mf_net_total',
    label: '总净额(万元)',
    kind: 'moneyflow',
    code: `// Preset: total net amount — net inflow across all order sizes (net_mf_amount), in 10k yuan. Flow semantics: null when no data that day, never carried forward.
export default defineFactor({
  name: '总净额(万元)',
  compute: (bar) => bar.netTotal,
});
`,
  },
];

export const BUILTIN_KEYS = new Set(BUILTIN_FACTORS.map((factor) => factor.key));

/** Catalog metadata for the presets — identity comes from this registry, code rows from the seed. */
export function builtinCatalog(): FactorMeta[] {
  return BUILTIN_FACTORS.map(({ key, label, kind }) => ({ key, label, kind, builtin: true }));
}

/**
 * Idempotent seed: materialize every preset into its read-only Factor row (called on server boot).
 * A code change in this file invalidates every user's cached reports of that key — the reports were
 * produced by a formula that no longer exists.
 */
export async function seedBuiltinFactors(): Promise<void> {
  for (const def of BUILTIN_FACTORS) {
    const existing = await prisma.factor.findUnique({
      where: { id: def.key },
      select: { code: true, name: true },
    });

    if (!existing) {
      await prisma.factor.create({
        data: { id: def.key, userId: BUILTIN_USER_ID, name: def.label, code: def.code },
      });
      continue;
    }
    if (existing.code !== def.code || existing.name !== def.label) {
      await prisma.factor.update({
        where: { id: def.key },
        data: { name: def.label, code: def.code },
      });
      if (existing.code !== def.code) {
        await prisma.factorReport.deleteMany({ where: { factor: def.key } });
      }
    }
  }
}
