/** Major broad-market indices whose close series are useful as research benchmarks.
 * This preset is intentionally broader than index_dailybasic, which supports fewer indices. */
export const MAJOR_INDEX_DAILY_CODES = [
  '000001.SH', // SSE Composite
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  '000905.SH', // CSI 500
  '000852.SH', // CSI 1000
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
    { key: 'sizeLadder', codes: ['000905.SH', '000852.SH', '932000.CSI'] },
  ],
  board: [
    { key: 'exchange', codes: ['000001.SH', '399001.SZ'] },
    {
      key: 'innovation',
      codes: ['399006.SZ', '000680.SH', '000688.SH', '931643.CSI'],
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
  ],
} as const;

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
