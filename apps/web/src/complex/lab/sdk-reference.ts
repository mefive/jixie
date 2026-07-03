/**
 * Single source of truth for the strategy SDK surface — one structured entry per user-facing member,
 * each with a TS signature + bilingual (中/EN) description. From this we GENERATE:
 *   - the Monaco ambient .d.ts (sdk-dts.ts → SDK_DTS): zh comments + a 📖 doc link per member/type;
 *   - the in-app SDK doc page (sdk-doc.tsx): grouped, 中/EN togglable, one anchor per `name` (+ per type).
 * Add a method/field here once and both stay in sync. (Runtime impl lives in apps/api sdk.ts; keep its
 * StrategyCtx interface aligned with the signatures here.)
 */

export interface SdkEntry {
  iface: 'Universe' | 'StrategyCtx' | 'BarRow';
  name: string; // member name — also the doc anchor id and the openSdkDoc command arg
  sig: string; // exact TS signature line emitted into the .d.ts
  group: string; // doc section
  zh: string;
  en: string;
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

const PRELUDE = `/** 某票某日的后复权 OHLC —— ctx.bars() 返回的单元。 [📖 文档](/docs#OhlcBar) */
interface OhlcBar {
${OHLC_FIELDS.map((f) => `  ${f.name}: ${f.type};`).join('\n')}
}

type Schedule = 'daily' | 'weekly' | 'monthly';`;

const POSTLUDE = `interface CodeStrategy {
  name?: string;
  /** Opt-in factor columns to preload, read via ctx.factor(). 资金流:'mf_net_main' / 'mf_net_total'. */
  factors?: string[];
  /** Instruments to preload bar series for up front (per-instrument systems). */
  watch?: string[];
  onBar(ctx: StrategyCtx): void | Promise<void>;
}

/** Define a strategy: export default defineStrategy({ onBar(ctx) { … } }). */
declare function defineStrategy(s: CodeStrategy): void;`;

export const SDK_ENTRIES: SdkEntry[] = [
  // —— Universe: today's candidate pool, a chainable filter/rank ——
  {
    iface: 'Universe',
    name: 'where',
    group: '选股链 Universe',
    sig: 'where(pred: (bar: BarRow, code: string) => boolean): Universe',
    zh: '保留 today-row 通过谓词的票。',
    en: 'Keep codes whose today-row passes the predicate.',
  },
  {
    iface: 'Universe',
    name: 'minListDays',
    group: '选股链 Universe',
    sig: 'minListDays(days: number): Universe',
    zh: '只保留上市满 days 天的票(时点股龄,剔除次新)。',
    en: 'Keep codes listed at least `days` calendar days (point-in-time age).',
  },
  {
    iface: 'Universe',
    name: 'dropBottom',
    group: '选股链 Universe',
    sig: 'dropBottom(frac: number, key: (bar: BarRow, code: string) => number): Universe',
    zh: '按 key 丢掉最低的 frac 比例(如流动性:dropBottom(0.25, b => b.turnoverRate ?? 0))。',
    en: 'Drop the bottom `frac` by `key` (e.g. liquidity floor).',
  },
  {
    iface: 'Universe',
    name: 'rankBy',
    group: '选股链 Universe',
    sig: "rankBy(score: (bar: BarRow, code: string) => number | null, dir?: 'desc' | 'asc'): Universe",
    zh: '按分数排序(null 分会被剔除);dir 默认 desc 高分在前。',
    en: 'Rank by a score (null-scoring dropped). dir default desc.',
  },
  {
    iface: 'Universe',
    name: 'top',
    group: '选股链 Universe',
    sig: 'top(n: number): string[]',
    zh: '取前 n;n<1 取比例(0.1=前十分位,至少 1),否则取个数。返回 string[]。',
    en: 'Leading slice: a fraction when n<1 (0.1=top decile), else a count.',
  },
  {
    iface: 'Universe',
    name: 'codes',
    group: '选股链 Universe',
    sig: 'codes(): string[]',
    zh: '当前链上的全部代码。',
    en: 'The current codes after the chain.',
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
    sig: 'factor(name: string, code: string): number | null',
    zh: '可选因子列(需在 factors 声明)当日值。资金流(万元,+流入/−流出):mf_net_main 主力净额、mf_net_total 全单净额。',
    en: "Opt-in factor column as-of today (declare in `factors`). 资金流: 'mf_net_main' / 'mf_net_total' (万元).",
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
    group: '指标(需 K 线已加载)',
    sig: 'sma(code: string, n: number): number | null',
    zh: 'n 日简单均线。',
    en: 'n-day simple moving average.',
  },
  {
    iface: 'StrategyCtx',
    name: 'ema',
    group: '指标(需 K 线已加载)',
    sig: 'ema(code: string, n: number): number | null',
    zh: 'n 日指数均线。',
    en: 'n-day exponential moving average.',
  },
  {
    iface: 'StrategyCtx',
    name: 'atr',
    group: '指标(需 K 线已加载)',
    sig: 'atr(code: string, n: number): number | null',
    zh: 'n 日 ATR(平均真实波幅)。',
    en: 'n-day ATR (average true range).',
  },
  {
    iface: 'StrategyCtx',
    name: 'highest',
    group: '指标(需 K 线已加载)',
    sig: "highest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null",
    zh: '最近 n 根某字段的最高(唐奇安上轨)。',
    en: 'Highest of a field over n bars (Donchian upper).',
  },
  {
    iface: 'StrategyCtx',
    name: 'lowest',
    group: '指标(需 K 线已加载)',
    sig: "lowest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null",
    zh: '最近 n 根某字段的最低(唐奇安下轨)。',
    en: 'Lowest of a field over n bars (Donchian lower).',
  },
  {
    iface: 'StrategyCtx',
    name: 'avgAmount',
    group: '指标(需 K 线已加载)',
    sig: 'avgAmount(code: string, n: number): number | null',
    zh: 'n 日平均成交额(千元)—— 流动性 / 滑点门。',
    en: 'n-day average turnover (千元) — liquidity gate.',
  },
  {
    iface: 'StrategyCtx',
    name: 'avgVol',
    group: '指标(需 K 线已加载)',
    sig: 'avgVol(code: string, n: number): number | null',
    zh: 'n 日平均成交量(手)。',
    en: 'n-day average volume (手).',
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
  },
  {
    iface: 'BarRow',
    name: 'amount',
    group: '业务类型 BarRow(整行字段)',
    sig: 'amount: number | null',
    zh: '成交额(千元)—— 流动性 / 滑点门。',
    en: 'Turnover (千元) — liquidity / slippage gate.',
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
  },
  {
    iface: 'BarRow',
    name: 'dvTtm',
    group: '业务类型 BarRow(整行字段)',
    sig: 'dvTtm: number | null',
    zh: '股息率(TTM)%。',
    en: 'Dividend yield (TTM) %.',
  },
  {
    iface: 'BarRow',
    name: 'totalMv',
    group: '业务类型 BarRow(整行字段)',
    sig: 'totalMv: number | null',
    zh: '总市值(万元)。',
    en: 'Total market cap (10k yuan).',
  },
  {
    iface: 'BarRow',
    name: 'circMv',
    group: '业务类型 BarRow(整行字段)',
    sig: 'circMv: number | null',
    zh: '流通市值(万元)。',
    en: 'Float market cap (10k yuan).',
  },
  {
    iface: 'BarRow',
    name: 'turnoverRate',
    group: '业务类型 BarRow(整行字段)',
    sig: 'turnoverRate: number | null',
    zh: '换手率 %。',
    en: 'Turnover rate %.',
  },
  {
    iface: 'BarRow',
    name: 'roe',
    group: '业务类型 BarRow(整行字段)',
    sig: 'roe: number | null',
    zh: '净资产收益率 %(时点)。',
    en: 'ROE % (point-in-time).',
  },
  {
    iface: 'BarRow',
    name: 'roeWaa',
    group: '业务类型 BarRow(整行字段)',
    sig: 'roeWaa: number | null',
    zh: '加权平均净资产收益率 %。',
    en: 'Weighted average ROE %.',
  },
];

// Read-only ctx properties (not callable members; emitted at the top of StrategyCtx, no doc anchor).
const CTX_PROPS = `  readonly date: string;
  readonly cash: number;
  readonly value: number;`;

/** Build the Monaco ambient .d.ts from the entries. Editor hovers are Chinese-only (the EN copy is for the
 * doc page); `docLink(name)` optionally appends a 📖 link line to each member's/type's JSDoc (→ /docs#name). */
export function buildSdkDts(docLink?: (name: string) => string): string {
  const member = (e: SdkEntry) => {
    const link = docLink ? `\n   * ${docLink(e.name)}` : '';
    return `  /** ${e.zh}${link} */\n  ${e.sig};`;
  };
  const ofIface = (iface: SdkEntry['iface']) =>
    SDK_ENTRIES.filter((e) => e.iface === iface)
      .map(member)
      .join('\n');
  const tl = (anchor: string) => (docLink ? ` ${docLink(anchor)}` : ''); // a type-level 📖 link

  return `${PRELUDE}

/** 某票今天的整行:不复权 + 后复权 OHLC + 时点估值快照(universe 里 rankBy/where 的 b)。${tl('BarRow')} */
interface BarRow {
${ofIface('BarRow')}
}

/** 今天的可交易候选池,链式 filter / rank / slice。${tl('Universe')} */
interface Universe {
${ofIface('Universe')}
  readonly length: number;
}

/** 策略每个 bar 看到、操作的入口 —— 下面所有 ctx.xxx 都是它的方法(读数据、算指标、下单);ctx 恒为「今天」。${tl('StrategyCtx')} */
interface StrategyCtx {
${CTX_PROPS}
${ofIface('StrategyCtx')}
}

${POSTLUDE}
`;
}
