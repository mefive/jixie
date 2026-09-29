/** Trading friction model: explicit fees (rates are fractions of trade value) + implicit slippage. Fees
 * hit `fee` on the trade; slippage instead worsens the fill PRICE (buys above / sells below the open), so
 * it shows up as a worse realized price, not a fee line. */
export interface CostModel {
  commission: number; // per-side rate, e.g. 0.00025 (0.025%)
  minCommission: number; // floor per trade in yuan, e.g. 5
  stampDuty: number; // sell-side only, e.g. 0.0005 (0.05%)
  transferFee: number; // both sides, e.g. 0.00001
  // —— Slippage (implicit cost, applied to the fill price) ——
  slippageBps: number; // base half-spread, both sides, in bps — the cost even for a liquid large-cap
  impactCoef: number; // linear price impact per (order notional / day turnover): a bigger order in a thinner
  //                     (small-cap) name pays more — this is what makes small/mid-cap / high-turnover realistically costlier
  futureCommissionRate: number; // per-side fraction of futures notional
  futureCloseTodayRate: number; // reserved for intraday close support
  futureSlippageTicks: number; // adverse ticks per futures fill
  futureMarginRate: number; // fallback when a historical settlement row has no margin rate
}

export const DEFAULT_COST: CostModel = {
  commission: 0.00025,
  minCommission: 5,
  stampDuty: 0.0005,
  transferFee: 0.00001,
  slippageBps: 2, // ~0.02% base half-spread
  impactCoef: 0.1, // order = 1% of the day's turnover → +0.1% slip; = 5% → +0.5%
  futureCommissionRate: 0.000023,
  futureCloseTodayRate: 0.00023,
  futureSlippageTicks: 1,
  futureMarginRate: 0.12,
};
