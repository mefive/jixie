/**
 * Single source of truth for the strategy SDK surface — one structured entry per user-facing member,
 * each with a TS signature + bilingual (zh/EN) description. From this we GENERATE:
 *   - the Monaco ambient .d.ts (apps/web sdk-dts.ts): zh comments + a 📖 doc link per member/type;
 *   - the in-app SDK doc page (apps/web sdk-doc.tsx): grouped, zh/EN toggle, one anchor per `name`;
 *   - the SDK-surface lists of the NL→code prompt (apps/api codegen-prompt.ts) via buildPromptSections().
 * Add a method/field here once and all three stay in sync. The runtime impl (apps/api sdk.ts) stays
 * hand-written; sdk-reference.test.ts type-checks entry names against the runtime members both ways,
 * so a runtime member without an entry here (or a ghost entry) fails typecheck.
 */

import type { Locale } from './i18n.js';
import { ENGINE_FACTORS, type EngineFactorDef } from './engine-factors.js';

export interface SdkEntry {
  iface: 'Universe' | 'StrategyCtx' | 'BarRow';
  name: string; // member name — also the doc anchor id and the openSdkDoc command arg
  sig: string; // exact TS signature line emitted into the .d.ts
  group: string; // doc section
  zh: string;
  en: string;
  /** Exact fragment for the codegen prompt's surface lists; omitted → derived from `name`/`sig`. */
  prompt?: string;
}

// Business types whose names are linkified (in declarations + the editor) + given a doc-section anchor.
export const LINKABLE_TYPES = ['StrategyCtx', 'BarRow', 'OhlcBar', 'Universe'] as const;

// OhlcBar is small + rarely hand-written, so it stays static (with its own 📖 link); its fields are
// documented in the doc page directly. (BarRow is generated from the entries below.)
export const OHLC_FIELDS: { name: string; type: string; zh: string; en: string }[] = [
  { name: 'date', type: 'string', zh: '交易日 YYYYMMDD', en: 'Trade date YYYYMMDD' },
  { name: 'adjOpen', type: 'number', zh: '后复权开盘价', en: 'hfq open' },
  { name: 'adjHigh', type: 'number', zh: '后复权最高价', en: 'hfq high' },
  { name: 'adjLow', type: 'number', zh: '后复权最低价', en: 'hfq low' },
  { name: 'adjClose', type: 'number', zh: '后复权收盘价', en: 'hfq close' },
  { name: 'vol', type: 'number | null', zh: '成交量(手)', en: 'Volume (手)' },
  { name: 'amount', type: 'number | null', zh: '成交额(千元)', en: 'Turnover (千元)' },
];

// Bilingual doc comments for the ambient types + prelude (member-level copy lives on each SdkEntry /
// OHLC_FIELDS). One entry per comment site so the editor hover switches with the active locale.
const TYPE_DOCS: Record<
  'ohlcBar' | 'barRow' | 'universe' | 'strategyCtx',
  Record<Locale, string>
> = {
  ohlcBar: {
    zh: '某票某日的后复权 OHLC —— ctx.bars() 返回的单元。 [📖 文档](/docs#OhlcBar)',
    en: 'Adjusted (hfq) OHLC of a code on a day — the unit ctx.bars() returns. [📖 docs](/docs#OhlcBar)',
  },
  barRow: {
    zh: '某票今天的整行:不复权 + 后复权 OHLC + 时点估值快照(universe 里 rankBy/where 的 b)。',
    en: "Today's full row for a code: raw + adjusted OHLC + a point-in-time valuation snapshot (the `b` in universe rankBy/where).",
  },
  universe: {
    zh: '今天的可交易候选池,链式 filter / rank / slice。',
    en: "Today's tradable candidate pool — a chainable filter / rank / slice.",
  },
  strategyCtx: {
    zh: '策略每个 bar 看到、操作的入口 —— 下面所有 ctx.xxx 都是它的方法(读数据、算指标、下单);ctx 恒为「今天」。',
    en: 'What the strategy sees and acts through on each bar — every ctx.xxx below is its method (read data, compute indicators, place orders); ctx is always "today".',
  },
};

const buildPrelude = (locale: Locale) => `/** ${TYPE_DOCS.ohlcBar[locale]} */
interface OhlcBar {
${OHLC_FIELDS.map((f) => `  ${f.name}: ${f.type};`).join('\n')}
}

type Schedule = 'daily' | 'weekly' | 'monthly';`;

const POSTLUDE = `interface CodeStrategy {
  name?: string;
  /** Opt-in factor columns, read via ctx.factor(): moneyflow columns + custom:<id> research factors. */
  factors?: FactorKey[];
  /** Instruments to preload bar series for up front (per-instrument systems). */
  watch?: string[];
  onBar(ctx: StrategyCtx): void | Promise<void>;
}

/** Define a strategy: export default defineStrategy({ onBar(ctx) { … } }). */
declare function defineStrategy(s: CodeStrategy): void;`;

/** A factor offered in the editor's FactorKey union — research-catalog identity, referenced as
 * custom:<key> (preset slug or the user's own factor id). */
export interface DtsFactorOption {
  key: string; // the full 'custom:<id>' key
  label: string; // the factor's display name (shown as a trailing comment in the union)
  description?: string; // optional summary shown by editor integrations
}

const FACTOR_KEY_DOC: Record<Locale, string> = {
  zh: '可通过 ctx.factor 读取的因子列 —— 需先在 factors 里声明;custom:<id> 为因子研究页的因子(预置 slug 或自定义 id)。',
  en: "Factor columns readable via ctx.factor — declare in `factors` first; custom:<id> references a research factor (preset slug or your own factor's id).",
};

/** The FactorKey ambient type: engine column factors (registry) + the known research factors, plus a
 * template-literal tail so a just-created factor doesn't red-squiggle before the catalog refreshes. */
function buildFactorKeyType(locale: Locale, factorOptions: DtsFactorOption[]): string {
  const columnMembers = ENGINE_FACTORS.map((def) => `  | '${def.key}' // ${def[locale]}`);
  const customMembers = factorOptions.map((option) => `  | '${option.key}' // ${option.label}`);
  return `/** ${FACTOR_KEY_DOC[locale]} */
type FactorKey =
${[...columnMembers, ...customMembers].join('\n')}
  | \`custom:\${string}\`;`;
}

// Doc-section names referenced by generators below (other groups are only display labels).
const INDICATOR_GROUP = '指标(需 K 线已加载)';

// `as const` keeps every `name` a literal type — the api-side drift test needs the literal union.
export const SDK_ENTRIES = [
  // —— Universe: today's candidate pool, a chainable filter/rank ——
  {
    iface: 'Universe',
    name: 'where',
    group: '选股链 Universe',
    sig: 'where(pred: (bar: BarRow, code: string) => boolean): Universe',
    zh: '保留 today-row 通过谓词的票。',
    en: 'Keep codes whose today-row passes the predicate.',
    prompt: '.where((b, code) => boolean)',
  },
  {
    iface: 'Universe',
    name: 'minListDays',
    group: '选股链 Universe',
    sig: 'minListDays(days: number): Universe',
    zh: '只保留上市满 days 天的票(时点股龄,剔除次新)。',
    en: 'Keep codes listed at least `days` calendar days (point-in-time age).',
    prompt: '.minListDays(days)',
  },
  {
    iface: 'Universe',
    name: 'dropBottom',
    group: '选股链 Universe',
    sig: 'dropBottom(frac: number, key: (bar: BarRow, code: string) => number): Universe',
    zh: '按 key 丢掉最低的 frac 比例(如流动性:dropBottom(0.25, b => b.turnoverRate ?? 0))。',
    en: 'Drop the bottom `frac` by `key` (e.g. liquidity floor).',
    prompt: '.dropBottom(fraction, b => value)',
  },
  {
    iface: 'Universe',
    name: 'rankBy',
    group: '选股链 Universe',
    sig: "rankBy(score: (bar: BarRow, code: string) => number | null, dir?: 'desc' | 'asc'): Universe",
    zh: '按分数排序(null 分会被剔除);dir 默认 desc 高分在前。',
    en: 'Rank by a score (null-scoring dropped). dir default desc.',
    prompt: ".rankBy(b => score, 'desc'|'asc') (null scores are dropped)",
  },
  {
    iface: 'Universe',
    name: 'top',
    group: '选股链 Universe',
    sig: 'top(n: number): string[]',
    zh: '取前 n;n<1 取比例(0.1=前十分位,至少 1),否则取个数。返回 string[]。',
    en: 'Leading slice: a fraction when n<1 (0.1=top decile), else a count.',
    prompt: '.top(n) (n<1 takes a fraction, otherwise a count) → string[]',
  },
  {
    iface: 'Universe',
    name: 'codes',
    group: '选股链 Universe',
    sig: 'codes(): string[]',
    zh: '当前链上的全部代码。',
    en: 'The current codes after the chain.',
    prompt: '.codes() → string[]',
  },

  // —— ctx: data ——
  {
    iface: 'StrategyCtx',
    name: 'universe',
    group: '数据 / 选股',
    sig: 'universe(indexCode?: string): Promise<Universe>',
    zh: '今天可交易的票,链式选股入口;传指数代码(如 000300.SH 沪深300)限定到其时点成分(只读该批行,更快)。',
    en: "Today's tradable universe (chainable). Pass an index code to restrict to its point-in-time constituents.",
  },
  {
    iface: 'StrategyCtx',
    name: 'bar',
    group: '数据 / 选股',
    sig: 'bar(code: string): BarRow | null',
    zh: '某票今天的整行(估值+行情);universe() 载入后才有值,否则 null。',
    en: "Today's full row for a code (valid after universe() loaded the panel), else null.",
  },
  {
    iface: 'StrategyCtx',
    name: 'indexMembers',
    group: '数据 / 选股',
    sig: 'indexMembers(indexCode: string): Promise<string[]>',
    zh: '某指数今天的时点成分代码(如 000300.SH)。',
    en: 'Point-in-time constituents of an index as of today.',
  },
  {
    iface: 'StrategyCtx',
    name: 'index',
    group: '数据 / 选股',
    sig: 'index(indexCode: string): { readonly close: number | null; sma(n: number): number | null }',
    zh: '大盘指数句柄(如 000300.SH 沪深300)时点只读:close 今日点位、sma(n) n 日均线。用于大盘择时滤网(如「沪深300 站上 200 日线才做多」)。指数≠个股,不可交易。数据来自 IndexDaily(需已同步),未同步返 null。',
    en: 'Index handle (e.g. 000300.SH 沪深300) — read-only, as-of today: close = level, sma(n) = n-day MA (on the index close). For 大盘择时 regime filters; an index is not tradable.',
  },
  {
    iface: 'StrategyCtx',
    name: 'industry',
    group: '数据 / 选股',
    sig: 'industry(code: string): string | null',
    zh: '行业标签(当前分类,非时点),如 银行 / 白酒;null 未知。用于行业中性 / 轮动 / 限定某行业。',
    en: 'Industry label (current classification, not point-in-time); null if unknown. For sector-neutral / rotation.',
  },
  {
    iface: 'StrategyCtx',
    name: 'lhbNet',
    group: '数据 / 选股',
    sig: 'lhbNet(code: string): number | null',
    zh: '今日龙虎榜净买入额(元);未上榜当天返 null(不前向填充)。关注度/游资极端信号。',
    en: "Today's 龙虎榜 net buy amount (yuan); null if not listed that day (never carried forward).",
  },
  {
    iface: 'StrategyCtx',
    name: 'factor',
    group: '数据 / 选股',
    sig: 'factor(name: FactorKey, code: string): number | null',
    zh: '可选因子列(需在 factors 声明)当日值。资金流(万元,+流入/−流出,精确当天):mf_net_main / mf_net_total;custom:<id> 为因子研究页的因子,逐日现场算(带 window 的需先 ensureBars)。',
    en: "Opt-in factor column for today (declare in `factors`). Moneyflow: 'mf_net_main' / 'mf_net_total' (万元, exact day). custom:<id> runs a research factor on the fly (windowed ones need ensureBars first).",
  },

  // —— ctx: per-instrument price/series ——
  {
    iface: 'StrategyCtx',
    name: 'price',
    group: '行情 / 序列',
    sig: 'price(code: string): number | null',
    zh: '今日后复权收盘价(停牌则前向填充);持仓/已加载的票才有值。',
    en: "Today's adjusted (hfq) close (carried forward if suspended).",
  },
  {
    iface: 'StrategyCtx',
    name: 'history',
    group: '行情 / 序列',
    sig: "history(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number[]",
    zh: '最近 n 个后复权价(某字段),持仓/已加载的票。',
    en: 'Last n adjusted prices (a field) for held/loaded codes.',
  },
  {
    iface: 'StrategyCtx',
    name: 'bars',
    group: '行情 / 序列',
    sig: 'bars(code: string, n: number): OhlcBar[]',
    zh: '最近 n 根后复权 OHLC(给唐奇安/ATR 等)。',
    en: 'Last n adjusted OHLC bars (Donchian / ATR etc.).',
  },
  {
    iface: 'StrategyCtx',
    name: 'ensureBars',
    group: '行情 / 序列',
    sig: 'ensureBars(codes: string[]): Promise<void>',
    zh: '懒加载这些票的 K 线序列,之后 bars()/history()/指标 才对它们有效。截面选出票要算个股指标前必调。',
    en: 'Lazily load bar series for codes so bars()/history()/indicators work on them this bar.',
  },
  {
    iface: 'StrategyCtx',
    name: 'listDays',
    group: '行情 / 序列',
    sig: 'listDays(code: string): number | null',
    zh: '今天距上市的日历天数(时点股龄);null 未知。',
    en: 'Calendar days since listing as of today; null if unknown.',
  },

  // —— ctx: indicators ——
  {
    iface: 'StrategyCtx',
    name: 'sma',
    group: INDICATOR_GROUP,
    sig: 'sma(code: string, n: number): number | null',
    zh: 'n 日简单均线。',
    en: 'n-day simple moving average.',
    prompt: 'ctx.sma(code,n)',
  },
  {
    iface: 'StrategyCtx',
    name: 'ema',
    group: INDICATOR_GROUP,
    sig: 'ema(code: string, n: number): number | null',
    zh: 'n 日指数均线。',
    en: 'n-day exponential moving average.',
    prompt: 'ctx.ema(code,n)',
  },
  {
    iface: 'StrategyCtx',
    name: 'atr',
    group: INDICATOR_GROUP,
    sig: 'atr(code: string, n: number): number | null',
    zh: 'n 日 ATR(平均真实波幅)。',
    en: 'n-day ATR (average true range).',
    prompt: 'ctx.atr(code,n)',
  },
  {
    iface: 'StrategyCtx',
    name: 'highest',
    group: INDICATOR_GROUP,
    sig: "highest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null",
    zh: '最近 n 根某字段的最高(唐奇安上轨)。',
    en: 'Highest of a field over n bars (Donchian upper).',
    prompt: 'ctx.highest(code,field,n)',
  },
  {
    iface: 'StrategyCtx',
    name: 'lowest',
    group: INDICATOR_GROUP,
    sig: "lowest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null",
    zh: '最近 n 根某字段的最低(唐奇安下轨)。',
    en: 'Lowest of a field over n bars (Donchian lower).',
    prompt: 'ctx.lowest(code,field,n)',
  },
  {
    iface: 'StrategyCtx',
    name: 'avgAmount',
    group: INDICATOR_GROUP,
    sig: 'avgAmount(code: string, n: number): number | null',
    zh: 'n 日平均成交额(千元)—— 流动性 / 滑点门。',
    en: 'n-day average turnover (千元) — liquidity gate.',
    prompt: 'ctx.avgAmount(code,n)=n-day average turnover (thousand yuan)',
  },
  {
    iface: 'StrategyCtx',
    name: 'avgVol',
    group: INDICATOR_GROUP,
    sig: 'avgVol(code: string, n: number): number | null',
    zh: 'n 日平均成交量(手)。',
    en: 'n-day average volume (手).',
    prompt: 'ctx.avgVol(code,n)=n-day average volume (lots)',
  },

  // —— ctx: schedule / sizing / state ——
  {
    iface: 'StrategyCtx',
    name: 'period',
    group: '调度 / 持仓 / 下单',
    sig: 'period(schedule: Schedule): string',
    zh: '今天在某周期上的键 —— 配合 let last 实现每月/每周只做一次。',
    en: 'Period key for today — compare to a `let last` to fire once per period.',
  },
  {
    iface: 'StrategyCtx',
    name: 'shares',
    group: '调度 / 持仓 / 下单',
    sig: 'shares(code: string): number',
    zh: '某票当前持仓股数(无则 0)。',
    en: 'Current shares held of a code (0 if none).',
  },
  {
    iface: 'StrategyCtx',
    name: 'positions',
    group: '调度 / 持仓 / 下单',
    sig: 'positions(): { code: string; shares: number; avgCost: number; marketValue: number }[]',
    zh: '当前所有持仓(代码/股数/成本/市值)。',
    en: 'All current positions (code / shares / avgCost / marketValue).',
  },
  {
    iface: 'StrategyCtx',
    name: 'equalWeight',
    group: '调度 / 持仓 / 下单',
    sig: 'equalWeight(codes: string[]): void',
    zh: '把这些票等权(次开成交的目标仓位调仓)。',
    en: 'Equal-weight the codes (a target-book rebalance at next open).',
  },
  {
    iface: 'StrategyCtx',
    name: 'orderTargetPercent',
    group: '调度 / 持仓 / 下单',
    sig: 'orderTargetPercent(code: string, weight: number): void',
    zh: '声明某票的目标权重(次开调仓)。',
    en: 'Declarative target weight for a code (rebalance at next open).',
  },
  {
    iface: 'StrategyCtx',
    name: 'setHoldings',
    group: '调度 / 持仓 / 下单',
    sig: 'setHoldings(weights: Record<string, number>): void',
    zh: '声明整张目标仓位表(代码→权重)。',
    en: 'Declarative target book (code → weight).',
  },
  {
    iface: 'StrategyCtx',
    name: 'order',
    group: '调度 / 持仓 / 下单',
    sig: 'order(code: string, shares: number): void',
    zh: '命令式下单:+买 / −卖,次开成交。',
    en: 'Imperative share order: +buy / -sell, filled at next open.',
  },
  {
    iface: 'StrategyCtx',
    name: 'exit',
    group: '调度 / 持仓 / 下单',
    sig: 'exit(code: string): void',
    zh: '清掉某票的全部持仓。',
    en: 'Sell the entire current position.',
  },

  // —— BarRow: the selection row (what universe()/bar() expose) ——
  {
    iface: 'BarRow',
    name: 'code',
    group: '业务类型 BarRow(整行字段)',
    sig: 'code: string',
    zh: '股票代码。',
    en: 'Stock code.',
  },
  {
    iface: 'BarRow',
    name: 'open',
    group: '业务类型 BarRow(整行字段)',
    sig: 'open: number | null',
    zh: '不复权开盘价。',
    en: 'Raw (unadjusted) open.',
  },
  {
    iface: 'BarRow',
    name: 'high',
    group: '业务类型 BarRow(整行字段)',
    sig: 'high: number | null',
    zh: '不复权最高价。',
    en: 'Raw high.',
  },
  {
    iface: 'BarRow',
    name: 'low',
    group: '业务类型 BarRow(整行字段)',
    sig: 'low: number | null',
    zh: '不复权最低价。',
    en: 'Raw low.',
  },
  {
    iface: 'BarRow',
    name: 'close',
    group: '业务类型 BarRow(整行字段)',
    sig: 'close: number | null',
    zh: '不复权收盘价。',
    en: 'Raw close.',
  },
  {
    iface: 'BarRow',
    name: 'adjOpen',
    group: '业务类型 BarRow(整行字段)',
    sig: 'adjOpen: number | null',
    zh: '后复权开盘价。',
    en: 'hfq open.',
  },
  {
    iface: 'BarRow',
    name: 'adjHigh',
    group: '业务类型 BarRow(整行字段)',
    sig: 'adjHigh: number | null',
    zh: '后复权最高价。',
    en: 'hfq high.',
  },
  {
    iface: 'BarRow',
    name: 'adjLow',
    group: '业务类型 BarRow(整行字段)',
    sig: 'adjLow: number | null',
    zh: '后复权最低价。',
    en: 'hfq low.',
  },
  {
    iface: 'BarRow',
    name: 'adjClose',
    group: '业务类型 BarRow(整行字段)',
    sig: 'adjClose: number | null',
    zh: '后复权收盘价。',
    en: 'hfq close.',
  },
  {
    iface: 'BarRow',
    name: 'vol',
    group: '业务类型 BarRow(整行字段)',
    sig: 'vol: number | null',
    zh: '成交量(手)。',
    en: 'Volume (手).',
    prompt: '**vol (volume, lots)**',
  },
  {
    iface: 'BarRow',
    name: 'amount',
    group: '业务类型 BarRow(整行字段)',
    sig: 'amount: number | null',
    zh: '成交额(千元)—— 流动性 / 滑点门。',
    en: 'Turnover (千元) — liquidity / slippage gate.',
    prompt: '**amount (turnover, thousand yuan — liquidity/slippage gate)**',
  },
  {
    iface: 'BarRow',
    name: 'pe',
    group: '业务类型 BarRow(整行字段)',
    sig: 'pe: number | null',
    zh: '市盈率。',
    en: 'P/E.',
  },
  {
    iface: 'BarRow',
    name: 'peTtm',
    group: '业务类型 BarRow(整行字段)',
    sig: 'peTtm: number | null',
    zh: '市盈率(TTM)。',
    en: 'P/E (TTM).',
  },
  {
    iface: 'BarRow',
    name: 'pb',
    group: '业务类型 BarRow(整行字段)',
    sig: 'pb: number | null',
    zh: '市净率。',
    en: 'P/B.',
  },
  {
    iface: 'BarRow',
    name: 'ps',
    group: '业务类型 BarRow(整行字段)',
    sig: 'ps: number | null',
    zh: '市销率。',
    en: 'P/S.',
  },
  {
    iface: 'BarRow',
    name: 'psTtm',
    group: '业务类型 BarRow(整行字段)',
    sig: 'psTtm: number | null',
    zh: '市销率(TTM)。',
    en: 'P/S (TTM).',
  },
  {
    iface: 'BarRow',
    name: 'dvRatio',
    group: '业务类型 BarRow(整行字段)',
    sig: 'dvRatio: number | null',
    zh: '股息率 %。',
    en: 'Dividend yield %.',
    prompt: 'dvRatio (dividend yield %)',
  },
  {
    iface: 'BarRow',
    name: 'dvTtm',
    group: '业务类型 BarRow(整行字段)',
    sig: 'dvTtm: number | null',
    zh: '股息率(TTM)%。',
    en: 'Dividend yield (TTM) %.',
    prompt: 'dvTtm (dividend yield TTM %)',
  },
  {
    iface: 'BarRow',
    name: 'totalMv',
    group: '业务类型 BarRow(整行字段)',
    sig: 'totalMv: number | null',
    zh: '总市值(万元)。',
    en: 'Total market cap (10k yuan).',
    prompt: 'totalMv (total market cap, ten-thousand yuan)',
  },
  {
    iface: 'BarRow',
    name: 'circMv',
    group: '业务类型 BarRow(整行字段)',
    sig: 'circMv: number | null',
    zh: '流通市值(万元)。',
    en: 'Float market cap (10k yuan).',
    prompt: 'circMv (float market cap, ten-thousand yuan)',
  },
  {
    iface: 'BarRow',
    name: 'turnoverRate',
    group: '业务类型 BarRow(整行字段)',
    sig: 'turnoverRate: number | null',
    zh: '换手率 %。',
    en: 'Turnover rate %.',
    prompt: 'turnoverRate (turnover rate %)',
  },
  {
    iface: 'BarRow',
    name: 'roe',
    group: '业务类型 BarRow(整行字段)',
    sig: 'roe: number | null',
    zh: '净资产收益率 %(时点)。',
    en: 'ROE % (point-in-time).',
    prompt: 'roe (ROE %, point-in-time)',
  },
  {
    iface: 'BarRow',
    name: 'roeWaa',
    group: '业务类型 BarRow(整行字段)',
    sig: 'roeWaa: number | null',
    zh: '加权平均净资产收益率 %。',
    en: 'Weighted average ROE %.',
    prompt: 'roeWaa (weighted ROE %, point-in-time)',
  },
] as const satisfies readonly SdkEntry[];

/** Literal union of the entry names of one interface — the anchor for the api-side drift type-test. */
export type SdkEntryName<I extends SdkEntry['iface']> = Extract<
  (typeof SDK_ENTRIES)[number],
  { iface: I }
>['name'];

// Read-only ctx properties (not callable members; emitted at the top of StrategyCtx, no doc anchor).
export const CTX_PROP_NAMES = ['date', 'cash', 'value'] as const;
const CTX_PROP_TYPES: Record<(typeof CTX_PROP_NAMES)[number], string> = {
  date: 'string',
  cash: 'number',
  value: 'number',
};
const CTX_PROPS = CTX_PROP_NAMES.map(
  (propName) => `  readonly ${propName}: ${CTX_PROP_TYPES[propName]};`,
).join('\n');

/** The codegen prompt's SDK-surface lists, generated so a new entry lands in the prompt automatically.
 * The prompt's narrative, examples, and capability boundary stay hand-written in codegen-prompt.ts;
 * each entry's `prompt` fragment (fallback: its name) is tuned wording, not the doc copy. */
export function buildPromptSections(): {
  indicators: string;
  universeChain: string;
  barRowFields: string;
  factorColumns: string;
} {
  const fragment = (entry: SdkEntry) => entry.prompt ?? entry.name;
  const entries = SDK_ENTRIES as readonly SdkEntry[];
  return {
    factorColumns: (ENGINE_FACTORS as readonly EngineFactorDef[])
      .map((def) => def.prompt ?? def.key)
      .join('; '),
    indicators: entries
      .filter((entry) => entry.iface === 'StrategyCtx' && entry.group === INDICATOR_GROUP)
      .map(fragment)
      .join(' / '),
    universeChain: entries
      .filter((entry) => entry.iface === 'Universe')
      .map(fragment)
      .join(', '),
    // `code` is the row key (exposed as the second lambda arg), not a screening field.
    barRowFields: entries
      .filter((entry) => entry.iface === 'BarRow' && entry.name !== 'code')
      .map(fragment)
      .join('/'),
  };
}

/** Build the Monaco ambient .d.ts from the entries in the active locale. Editor hovers carry the
 * locale-appropriate copy (`entry[locale]`); `docLink(name)` optionally appends a 📖 link line to each
 * member's/type's JSDoc (→ /docs#name). */
export function buildSdkDts(
  locale: Locale,
  docLink?: (name: string) => string,
  factorOptions: DtsFactorOption[] = [],
): string {
  const member = (e: SdkEntry) => {
    const link = docLink ? `\n   * ${docLink(e.name)}` : '';
    return `  /** ${e[locale]}${link} */\n  ${e.sig};`;
  };
  const ofIface = (iface: SdkEntry['iface']) =>
    SDK_ENTRIES.filter((e) => e.iface === iface)
      .map(member)
      .join('\n');
  const tl = (anchor: string) => (docLink ? ` ${docLink(anchor)}` : ''); // a type-level 📖 link

  return `${buildPrelude(locale)}

${buildFactorKeyType(locale, factorOptions)}

/** ${TYPE_DOCS.barRow[locale]}${tl('BarRow')} */
interface BarRow {
${ofIface('BarRow')}
}

/** ${TYPE_DOCS.universe[locale]}${tl('Universe')} */
interface Universe {
${ofIface('Universe')}
  readonly length: number;
}

/** ${TYPE_DOCS.strategyCtx[locale]}${tl('StrategyCtx')} */
interface StrategyCtx {
${CTX_PROPS}
${ofIface('StrategyCtx')}
}

${POSTLUDE}
`;
}
