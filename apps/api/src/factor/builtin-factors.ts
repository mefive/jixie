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

const MOMENTUM_CODE = `// 预置:动量 —— 近60日收益,跳过最近5日(避开短期反转污染)。
// 窗口内相邻交易日的日历间隔 > 30 天(≈ 停牌1个月以上)视为序列不连续,该期剔除。
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
    const recent = closes[55]; // 当天 - 5
    const past = closes[0]; // 当天 - 60
    if (!recent || !past) {
      return null;
    }
    return recent / past - 1;
  },
});

// 两个 YYYYMMDD 之间的日历天数
function gapDays(a: string, b: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6)) / 86400000;
  return day(b) - day(a);
}
`;

const REVERSAL_CODE = `// 预置:短期反转 —— 近5日收益(A股散户主导,该因子 IC 通常为负 = 买跌得最狠的)。
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

// 两个 YYYYMMDD 之间的日历天数
function gapDays(a: string, b: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6)) / 86400000;
  return day(b) - day(a);
}
`;

const VOLATILITY_CODE = `// 预置:已实现波动率 —— 近20日日收益率标准差(低波动异象,IC 通常为负 = 低波更好)。
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

// 两个 YYYYMMDD 之间的日历天数
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
    code: `// 预置:盈利收益率 —— PE_TTM 的倒数(便宜=值大);亏损股(PE≤0)剔除。
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
    code: `// 预置:账面市值比 —— PB 的倒数(经典价值因子)。
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
    code: `// 预置:股息率 —— daily_basic 的 dvRatio 原值(%)。
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
    code: `// 预置:规模 —— ln(总市值)。方向由 IC 揭示(A股长期小盘溢价 = IC 为负)。
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
    code: `// 预置:主力净额 —— (大单+特大单)买入−卖出,万元。流量语义:当日无数据为 null,不前填。
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
    code: `// 预置:总净额 —— 全单种净流入(net_mf_amount),万元。流量语义:当日无数据为 null,不前填。
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
