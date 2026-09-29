import type { FutureAccountSnapshot, SignalExecutionLeg, SignalFutureIntent } from '@jixie/shared';

export type FutureLedgerPosition = FutureAccountSnapshot['positions'][number];

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

/** Apply an observed fill without pricing it or rejecting an already executed trade for margin. */
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

export function resolveFutureTarget(input: {
  intent: SignalFutureIntent;
  current: number;
  price: number;
  multiplier: number;
  cashExposure: number;
}): number {
  const { intent, current, price, multiplier, cashExposure } = input;
  let target: number;
  switch (intent.kind) {
    case 'delta':
      target = Math.trunc(current + intent.value);
      break;
    case 'contracts':
      target = Math.trunc(intent.value);
      break;
    case 'roll':
      target = current;
      break;
    case 'notional':
      target = Math.trunc(intent.value / (price * multiplier));
      break;
    case 'hedge':
      target = Math.trunc((-intent.value * cashExposure) / (price * multiplier));
      break;
  }

  return target === 0 ? 0 : target;
}

/** Preserve separate close/open legs, including multiple old delivery contracts. */
export function resolveFutureLegs(input: {
  code: string;
  actualCode: string;
  multiplier: number;
  target: number;
  positions: FutureLedgerPosition[];
}): SignalExecutionLeg[] {
  const legs: SignalExecutionLeg[] = [];
  let remaining = input.target;
  for (const position of input.positions.filter((value) => value.code === input.code)) {
    const retained =
      position.actualCode === input.actualCode && position.contracts * remaining > 0
        ? Math.sign(remaining) * Math.min(Math.abs(position.contracts), Math.abs(remaining))
        : 0;
    const close = position.contracts - retained;
    remaining -= retained;
    if (close) {
      legs.push({
        id: `${input.code}:${legs.length}`,
        code: input.code,
        actualCode: position.actualCode,
        action: close > 0 ? 'sell' : 'buy',
        effect: 'close',
        positionSide: close > 0 ? 'long' : 'short',
        contracts: Math.abs(close),
        multiplier: position.multiplier,
        dependsOnLegId: null,
      });
    }
  }
  if (remaining) {
    legs.push({
      id: `${input.code}:${legs.length}`,
      code: input.code,
      actualCode: input.actualCode,
      action: remaining > 0 ? 'buy' : 'sell',
      effect: 'open',
      positionSide: remaining > 0 ? 'long' : 'short',
      contracts: Math.abs(remaining),
      multiplier: input.multiplier,
      dependsOnLegId: legs.at(-1)?.id ?? null,
    });
  }

  return legs;
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
