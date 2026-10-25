import type { FutureAccountSnapshot } from './result.js';

export type FutureLedgerPosition = FutureAccountSnapshot['positions'][number];

/**
 * 承载已观测期货成交的合约、方向、数量与价格，供账本重放。
 *
 * Describe an observed futures fill for deterministic account posting.
 */
export interface FutureFillInput {
  position: FutureLedgerPosition | null;
  code: string;
  actualCode: string;
  delta: number;
  price: number;
  multiplier: number;
  fee: number;
  marginRate: number;
}

/**
 * 将已发生的期货成交记入账户，不重新定价，也不因保证金不足拒绝历史成交。
 *
 * Apply an observed fill without pricing it or rejecting an already executed trade for margin.
 */
export function applyFutureFill(input: FutureFillInput): {
  position: FutureLedgerPosition | null;
  equityChange: number;
} {
  const { position, delta, price, multiplier, fee, marginRate } = input;
  if (
    ![delta, price, multiplier, fee, marginRate].every(Number.isFinite) ||
    !Number.isInteger(delta) ||
    price <= 0 ||
    multiplier <= 0 ||
    fee < 0 ||
    marginRate <= 0 ||
    marginRate > 1
  ) {
    throw new Error('Invalid futures fill');
  }
  if (
    position &&
    (position.actualCode !== input.actualCode || position.multiplier !== multiplier)
  ) {
    throw new Error('Futures fill contract does not match its position');
  }

  const oldContracts = position?.contracts ?? 0;
  const contracts = oldContracts + delta;
  const closed = oldContracts * delta < 0 ? Math.min(Math.abs(oldContracts), Math.abs(delta)) : 0;
  const realized =
    closed * Math.sign(oldContracts) * (price - (position?.referencePrice ?? price)) * multiplier;
  let referencePrice = position?.referencePrice ?? price;
  if (oldContracts === 0 || contracts === 0 || Math.sign(oldContracts) !== Math.sign(contracts)) {
    referencePrice = price;
  } else if (Math.abs(contracts) > Math.abs(oldContracts)) {
    referencePrice =
      (Math.abs(oldContracts) * referencePrice +
        (Math.abs(contracts) - Math.abs(oldContracts)) * price) /
      Math.abs(contracts);
  }

  return {
    equityChange: realized - fee,
    position:
      contracts === 0
        ? null
        : {
            code: input.code,
            actualCode: input.actualCode,
            contracts,
            referencePrice,
            multiplier,
            margin: Math.abs(contracts) * price * multiplier * marginRate,
          },
  };
}

/**
 * 按结算价更新单合约变动盈亏与保证金基准。
 *
 * Settle one contract's variation profit and margin basis.
 */
export function settleFuturePosition(
  position: FutureLedgerPosition,
  price: number,
  marginRate: number,
) {
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(marginRate) ||
    marginRate <= 0 ||
    marginRate > 1
  ) {
    throw new Error(`Invalid settlement input for ${position.actualCode}`);
  }

  return {
    equityChange: position.contracts * (price - position.referencePrice) * position.multiplier,
    position: {
      ...position,
      referencePrice: price,
      margin: Math.abs(position.contracts) * price * position.multiplier * marginRate,
    },
  };
}

export function normalizeFutureMargin(source: number | null, fallback: number): number {
  if (source != null && source > 0 && source <= 1) {
    return source;
  }
  if (source != null && source > 1 && source <= 100) {
    return source / 100;
  }

  return fallback;
}
