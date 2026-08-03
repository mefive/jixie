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
