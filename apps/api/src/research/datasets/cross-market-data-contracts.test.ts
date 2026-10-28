import { describe, expect, it } from 'vitest';
import {
  compactCrossMarketDataContractRegistry,
  crossMarketDataContractRegistry,
  researchBindingDataContract,
  researchDataContractById,
  researchSourceDecisionById,
  validateCrossMarketDataContractRegistry,
} from './cross-market-data-contracts.js';

describe('retained research data contracts', () => {
  it('keeps source, binding, currency and provider-use constraints for retained contracts', () => {
    expect(validateCrossMarketDataContractRegistry).not.toThrow();
    for (const contract of crossMarketDataContractRegistry.contracts) {
      expect(contract.market).toBe('CN');
      expect(researchBindingDataContract(contract.id)).toBe(contract.binding);
      const decision = researchSourceDecisionById.get(contract.sourceDecisionId)!;
      expect(decision.license.redistribution).toBe('prohibited_without_separate_authorization');
      expect(decision.evidence).toContainEqual(
        expect.objectContaining({ url: 'https://tushare.pro/document/1?doc_id=405' }),
      );
    }
  });

  it('publishes only supported stock and ETF sources instead of executable foreign placeholders', () => {
    const catalog = compactCrossMarketDataContractRegistry();
    expect(catalog.contracts.map((contract) => contract.id)).toEqual([
      'cn.equity.adjusted_close.daily',
      'cn.etf.adjusted_close.daily',
      'cn.etf.share_size.daily',
    ]);
    expect(catalog.sourceDecisions.map((decision) => decision.id)).toEqual([
      'tushare.cn_equity',
      'tushare.cn_etf',
    ]);
    for (const id of [
      'cn.sovereign_yield.daily',
      'us.sovereign_yield.daily',
      'hk.equity_benchmark.price.daily',
      'cn.macro.monthly.pit',
    ]) {
      expect(() => researchBindingDataContract(id)).toThrow();
    }
  });

  it('retains stock identity and next-session ETF share availability', () => {
    expect(researchDataContractById.get('cn.equity.adjusted_close.daily')).toMatchObject({
      status: 'integrated',
      market: 'CN',
      currency: { quoteCurrency: 'CNY' },
      calendar: { timeZone: 'Asia/Shanghai', observesDaylightSavingTime: false },
    });
    expect(researchDataContractById.get('cn.etf.share_size.daily')).toMatchObject({
      status: 'integrated',
      pointInTime: { availableDatePolicy: expect.stringContaining('strictly later SSE session') },
      binding: { unit: 'totalShare=10k_fund_units;totalSize=10k_CNY' },
    });
    expect(crossMarketDataContractRegistry.fixtures.map((fixture) => fixture.id)).toEqual([
      'cn-stock-000001-sz',
      'cn-etf-csi300-share-size',
    ]);
  });
});
