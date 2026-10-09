import type { StrategyCapabilities } from './capabilities.js';
import type { StockAccount } from '@jixie/shared/sdk/strategy/contract';
import { atrBars, sampleDeviation } from './indicators.js';

/** Add public stock helpers while preserving detached calls and live account getters. */
export function createStockAccount(capabilities: StrategyCapabilities): StockAccount {
  const stockHelpers: Pick<StockAccount, 'equalWeight' | 'atrAdjustedShares' | 'volTargetWeights'> =
    {
      equalWeight: (codes) => {
        const weight = codes.length ? 1 / codes.length : 0;
        const targets: Record<string, number> = {};
        for (const code of codes) {
          targets[code] = weight;
        }
        capabilities.stock.setTargetWeights(targets);
      },
      atrAdjustedShares: (code, riskPct, atrPeriod = 20) => {
        const window = Math.floor(atrPeriod);
        if (!(riskPct > 0) || window <= 0) {
          return 0;
        }
        const atr = atrBars(capabilities.bars(code, window + 1), window);
        return atr == null || atr <= 0
          ? 0
          : Math.floor((capabilities.stock.equity * riskPct) / atr);
      },
      volTargetWeights: (codes, lookback = 20) => {
        const window = Math.floor(lookback);
        if (window < 2) {
          return new Map();
        }
        const inverseVol = new Map<string, number>();
        for (const code of codes) {
          const closes = capabilities.history(code, 'close', window + 1);
          if (closes.length < window + 1) {
            continue;
          }
          const returns = closes
            .slice(1)
            .map((close, index) => close / closes[index] - 1)
            .filter(Number.isFinite);
          if (returns.length !== window) {
            continue;
          }
          const volatility = sampleDeviation(returns);
          if (volatility > 0) {
            inverseVol.set(code, 1 / volatility);
          }
        }
        const total = [...inverseVol.values()].reduce((sum, value) => sum + value, 0);
        return new Map([...inverseVol].map(([code, value]) => [code, value / total]));
      },
    };

  return {
    positions: (...args) => capabilities.stock.positions(...args),
    adjustedShares: (...args) => capabilities.stock.adjustedShares(...args),
    setTargetWeight: (...args) => capabilities.stock.setTargetWeight(...args),
    setTargetWeights: (...args) => capabilities.stock.setTargetWeights(...args),
    orderAdjustedShares: (...args) => capabilities.stock.orderAdjustedShares(...args),
    orderLots: (...args) => capabilities.stock.orderLots(...args),
    closePosition: (...args) => capabilities.stock.closePosition(...args),
    stopLossAtAdjustedPrice: (...args) => capabilities.stock.stopLossAtAdjustedPrice(...args),
    trailingStopByFraction: (...args) => capabilities.stock.trailingStopByFraction(...args),
    limitBuyAtAdjustedPrice: (...args) => capabilities.stock.limitBuyAtAdjustedPrice(...args),
    takeProfitByFraction: (...args) => capabilities.stock.takeProfitByFraction(...args),
    cancelConditional: (...args) => capabilities.stock.cancelConditional(...args),
    // Preserve live account valuation if a later data read loads additional prices.
    get equity() {
      return capabilities.stock.equity;
    },
    get availableCash() {
      return capabilities.stock.availableCash;
    },
    ...stockHelpers,
  };
}
