/** Major broad-market indices whose close series are useful as research benchmarks.
 * This preset is intentionally broader than index_dailybasic, which supports fewer indices. */
export const CSI_300_TOTAL_RETURN_INDEX_CODE = 'H00300.CSI';

export const MAJOR_INDEX_DAILY_CODES = [
  '000001.SH', // SSE Composite
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  CSI_300_TOTAL_RETURN_INDEX_CODE, // CSI 300 total return — backtest performance benchmark
  '000905.SH', // CSI 500
  '000852.SH', // CSI 1000
  '000985.CSI', // CSI All Share — market-residual-volatility benchmark
  '932000.CSI', // CSI 2000
  '000510.SH', // CSI A500
  '000688.SH', // STAR 50
  '000922.CSI', // CSI Dividend
  '399001.SZ', // Shenzhen Component
  '399005.SZ', // SME Board
  '399006.SZ', // ChiNext
] as const;

/** Official growth/value pairs selected from Tushare mkt_idx_bmk where idx_type=风格类指数. */
export const MARKET_STYLE_INDEX_PAIRS = [
  { key: 'csi300', growth: '000918.CSI', value: '000919.CSI' },
  { key: 'csi500', growth: 'H30351.CSI', value: 'H30352.CSI' },
  { key: 'csi800', growth: 'H30355.CSI', value: 'H30356.CSI' },
] as const;

export const MARKET_STYLE_INDEX_CODES = MARKET_STYLE_INDEX_PAIRS.flatMap((pair) => [
  pair.growth,
  pair.value,
]);

/** Curated official indices exposed by the card-only market weather dashboard. Classification is
 * sourced from mkt_idx_bmk; the grouping is a product navigation choice, not inferred taxonomy. */
export const MARKET_WEATHER_INDEX_GROUPS = {
  scale: [
    { key: 'wholeMarket', codes: ['000985.CSI'] },
    {
      key: 'largeCore',
      codes: ['000016.SH', '930050.CSI', '000903.SH', '000300.SH', '000510.SH'],
    },
    { key: 'largeMid', codes: ['000906.SH'] },
    { key: 'sizeLadder', codes: ['000905.SH', '000852.SH', '932000.CSI'] },
  ],
  board: [
    { key: 'exchange', codes: ['000001.SH', '399001.SZ'] },
    {
      key: 'innovation',
      codes: ['399006.SZ', '399102.SZ', '000680.SH', '000688.SH', '931643.CSI'],
    },
    { key: 'beijing', codes: ['899050.BJ'] },
  ],
  style: [
    { key: 'csi300', codes: ['000918.CSI', '000919.CSI'] },
    { key: 'csi500', codes: ['H30351.CSI', 'H30352.CSI'] },
    { key: 'csi800', codes: ['H30355.CSI', 'H30356.CSI'] },
    { key: 'csi1000', codes: ['932392.CSI', '932393.CSI'] },
    { key: 'broadStyle', codes: ['399370.SZ', '399371.SZ'] },
    { key: 'income', codes: ['000922.CSI'] },
    {
      key: 'coreFactors',
      codes: ['000984.CSI', 'H30260.CSI', '930860.CSI', '930955.CSI', '980092.SZ'],
    },
  ],
} as const;

/** Canonical official fallback names for newly allowlisted indices. mkt_idx_bmk metadata wins when
 * the smaller public-fund benchmark catalog contains the code. */
export const MARKET_WEATHER_INDEX_NAMES: Readonly<Record<string, string>> = {
  '000906.SH': '中证800',
  '399102.SZ': '创业板综',
  '000984.CSI': '300等权',
  'H30260.CSI': '300动量',
  '930860.CSI': '盈利质量',
  '930955.CSI': '红利低波100',
  '980092.SZ': '国证自由现金流',
};

/** Parent benchmarks used to separate factor relative strength from broad market beta. */
export const MARKET_WEATHER_INDEX_BENCHMARKS: Readonly<Record<string, string>> = {
  '000918.CSI': '000300.SH',
  '000919.CSI': '000300.SH',
  'H30351.CSI': '000905.SH',
  'H30352.CSI': '000905.SH',
  'H30355.CSI': '000906.SH',
  'H30356.CSI': '000906.SH',
  '932392.CSI': '000852.SH',
  '932393.CSI': '000852.SH',
  '000922.CSI': '000985.CSI',
  '000984.CSI': '000300.SH',
  'H30260.CSI': '000300.SH',
  '930860.CSI': '000985.CSI',
  '930955.CSI': '000985.CSI',
  '980092.SZ': '000985.CSI',
};

export const MARKET_WEATHER_INDUSTRY_GROUPS = [
  { key: 'financial', codes: ['801780.SI', '801790.SI', '801180.SI'] },
  {
    key: 'technology',
    codes: ['801080.SI', '801750.SI', '801770.SI', '801760.SI', '801740.SI'],
  },
  {
    key: 'resources',
    codes: [
      '801030.SI',
      '801040.SI',
      '801050.SI',
      '801710.SI',
      '801720.SI',
      '801950.SI',
      '801960.SI',
    ],
  },
  {
    key: 'manufacturing',
    codes: ['801730.SI', '801880.SI', '801890.SI', '801140.SI', '801970.SI'],
  },
  {
    key: 'consumer',
    codes: [
      '801010.SI',
      '801110.SI',
      '801120.SI',
      '801130.SI',
      '801200.SI',
      '801210.SI',
      '801980.SI',
    ],
  },
  { key: 'defensive', codes: ['801150.SI', '801160.SI', '801170.SI', '801230.SI'] },
] as const;

export type MarketWeatherIndexDimension = keyof typeof MARKET_WEATHER_INDEX_GROUPS;

export const MARKET_WEATHER_INDEX_CODES = [
  ...new Set(
    Object.values(MARKET_WEATHER_INDEX_GROUPS).flatMap((groups) =>
      groups.flatMap((group) => group.codes),
    ),
  ),
] as string[];

/** All index universes whose monthly point-in-time constituents feed weather-card breadth,
 * activity, and constituent-derived valuation. */
export const MARKET_WEATHER_INDICATOR_INDEX_CODES = [...MARKET_WEATHER_INDEX_CODES] as string[];

/** All official index close series that daily maintenance keeps current. */
export const DAILY_MAINTAINED_INDEX_CODES = [
  ...new Set([...MAJOR_INDEX_DAILY_CODES, ...MARKET_WEATHER_INDEX_CODES]),
] as string[];

/** Broad-market indices supported by Tushare index_dailybasic.
 * This is a data-coverage preset, not an investment recommendation. */
export const MAJOR_INDEX_DAILY_BASIC_CODES = [
  '000001.SH', // SSE Composite
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  '000905.SH', // CSI 500
  '399001.SZ', // Shenzhen Component
  '399005.SZ', // SME Board
  '399006.SZ', // ChiNext
] as const;

/** Point-in-time constituent universes exposed by the market-state scope selector. */
export const MARKET_STATE_INDEX_CODES = [
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  '000905.SH', // CSI 500
  '000852.SH', // CSI 1000
  '932000.CSI', // CSI 2000
  '000510.SH', // CSI A500
  '399006.SZ', // ChiNext
  '000688.SH', // STAR 50
  '000922.CSI', // CSI Dividend
] as const;
