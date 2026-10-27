/**
 * 描述显式费率和隐式滑点；费用计入成交 fee，滑点通过不利成交价格体现。
 *
 * Trading friction model: explicit fees (rates are fractions of trade value) + implicit slippage. Fees
 * hit `fee` on the trade; slippage instead worsens the fill PRICE (buys above / sells below the open), so
 * it shows up as a worse realized price, not a fee line.
 */
export interface CostModel {
  commission: number; // per-side rate, e.g. 0.00025 (0.025%)
  minCommission: number; // floor per trade in yuan, e.g. 5
  stampDuty: number; // sell-side only, e.g. 0.0005 (0.05%)
  transferFee: number; // both sides, e.g. 0.00001
  // —— Slippage (implicit cost, applied to the fill price) ——
  slippageBps: number; // base half-spread, both sides, in bps — the cost even for a liquid large-cap
  impactCoef: number; // 线性冲击：订单金额 / 日成交额。 / Linear impact per order notional / daily turnover.
}

export const DEFAULT_COST: CostModel = {
  commission: 0.00025,
  minCommission: 5,
  stampDuty: 0.0005,
  transferFee: 0.00001,
  slippageBps: 2, // ~0.02% base half-spread
  impactCoef: 0.1, // 订单占日成交额 1% → 额外 0.1% 滑点。 / A 1% participation adds 0.1% slippage.
};
