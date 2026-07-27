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
