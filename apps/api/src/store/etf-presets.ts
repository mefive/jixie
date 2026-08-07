/** Liquid, history-rich representatives for the first ETF daily-strategy lane.
 * Selection uses one ETF per major exposure; it is a data preset, not investment advice. */
export const MAJOR_ETF_CODES = [
  '510050.SH', // SSE 50
  '510300.SH', // CSI 300
  '563360.SH', // CSI A500
  '510500.SH', // CSI 500
  '512100.SH', // CSI 1000
  '563300.SH', // CSI 2000
  '159915.SZ', // ChiNext
  '588000.SH', // STAR 50
  '510880.SH', // SSE Dividend
  '518880.SH', // Gold
  '513100.SH', // Nasdaq 100 QDII
  '511010.SH', // 5-year government bond
  '511260.SH', // 10-year government bond
  '511090.SH', // 30-year government bond
] as const;

export const MAJOR_ETF_CODE_SET = new Set<string>(MAJOR_ETF_CODES);
