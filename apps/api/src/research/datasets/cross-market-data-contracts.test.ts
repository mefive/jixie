import { describe, expect, it } from 'vitest';
import {
  compactCrossMarketDataContractRegistry,
  crossMarketDataContractRegistry,
  researchBindingDataContract,
  researchDataContractById,
  researchSourceDecisionById,
  validateCrossMarketDataContractRegistry,
} from './cross-market-data-contracts.js';

describe('crossMarketDataContractRegistry', () => {
  it('validates every versioned contract, source decision, and fixture reference', () => {
    expect(validateCrossMarketDataContractRegistry).not.toThrow();
    expect(crossMarketDataContractRegistry.version).toBe(1);
    expect(crossMarketDataContractRegistry.sourceMatrixVersion).toBe(1);

    for (const contract of crossMarketDataContractRegistry.contracts) {
      expect(researchSourceDecisionById.has(contract.sourceDecisionId)).toBe(true);
      expect(researchBindingDataContract(contract.id)).toBe(contract.binding);
    }
    for (const decision of crossMarketDataContractRegistry.sourceDecisions.filter((item) =>
      item.provider.startsWith('Tushare'),
    )) {
      expect(decision.license.redistribution).toBe('prohibited_without_separate_authorization');
      expect(decision.evidence).toContainEqual(
        expect.objectContaining({ url: 'https://tushare.pro/document/1?doc_id=405' }),
      );
    }
  });

  it('expresses real China, Hong Kong, and US equity differences without claiming planned data is local', () => {
    const china = researchDataContractById.get('cn.equity.adjusted_close.daily')!;
    const hongKong = researchDataContractById.get('hk.equity.adjusted_close.daily')!;
    const unitedStates = researchDataContractById.get('us.equity.adjusted_close.daily')!;

    expect(china).toMatchObject({
      status: 'integrated',
      market: 'CN',
      calendar: { timeZone: 'Asia/Shanghai', observesDaylightSavingTime: false },
      currency: { quoteCurrency: 'CNY' },
    });
    expect(hongKong).toMatchObject({
      status: 'planned',
      market: 'HK',
      calendar: { timeZone: 'Asia/Hong_Kong', observesDaylightSavingTime: false },
      currency: { quoteCurrency: 'HKD' },
    });
    expect(unitedStates).toMatchObject({
      status: 'planned',
      market: 'US',
      calendar: { timeZone: 'America/New_York', observesDaylightSavingTime: true },
      currency: { quoteCurrency: 'USD' },
    });
    expect(researchSourceDecisionById.get(hongKong.sourceDecisionId)).toMatchObject({
      status: 'candidate',
      license: {
        localResearchUse: 'requires_permission_probe',
        redistribution: 'prohibited_without_separate_authorization',
      },
    });
    expect(researchSourceDecisionById.get(unitedStates.sourceDecisionId)).toMatchObject({
      status: 'candidate',
      license: {
        localResearchUse: 'requires_permission_probe',
        redistribution: 'prohibited_without_separate_authorization',
      },
    });
  });

  it('validates one stock per target market, one bond series, and one commodity series', () => {
    expect(crossMarketDataContractRegistry.fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cn-stock-000001-sz',
          providerId: '000001.SZ',
          expected: expect.objectContaining({ market: 'CN', assetClass: 'equity' }),
        }),
        expect.objectContaining({
          id: 'hk-stock-00001-hk',
          providerId: '00001.HK',
          expected: expect.objectContaining({ market: 'HK', assetClass: 'equity' }),
        }),
        expect.objectContaining({
          id: 'us-stock-aapl',
          providerId: 'AAPL',
          expected: expect.objectContaining({ market: 'US', assetClass: 'equity' }),
        }),
        expect.objectContaining({
          id: 'cn-bond-10y-cgb',
          providerId: 'chinabond_cgb_ytm|10',
          expected: expect.objectContaining({ assetClass: 'bond' }),
        }),
        expect.objectContaining({
          id: 'cn-etf-csi300-share-size',
          providerId: '510300.SH',
          expected: expect.objectContaining({ market: 'CN', quoteCurrency: 'CNY' }),
        }),
        expect.objectContaining({
          id: 'cn-commodity-au-continuous',
          providerId: 'AU.SHF',
          expected: expect.objectContaining({ assetClass: 'commodity' }),
        }),
      ]),
    );
  });

  it('publishes a compact Agent view with explicit source and contract status', () => {
    const compact = compactCrossMarketDataContractRegistry();

    expect(compact.contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'us.equity.adjusted_close.daily', status: 'planned' }),
      ]),
    );
    expect(compact.sourceDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tushare.us_equity', status: 'candidate' }),
      ]),
    );
  });

  it('keeps integrated price benchmarks separate from planned foreign individual equities', () => {
    expect(researchDataContractById.get('hk.equity_benchmark.price.daily')).toMatchObject({
      status: 'integrated',
      instrumentType: 'price_index_benchmark',
      currency: {
        quoteCurrency: 'HKD',
        baseCurrencyReturnPolicy: expect.stringContaining('USDCNH divided by USDHKD'),
      },
      corporateActions: { totalReturnPolicy: expect.stringContaining('price return only') },
    });
    expect(researchDataContractById.get('us.equity.adjusted_close.daily')).toMatchObject({
      status: 'planned',
      instrumentType: 'stock',
    });
  });

  it('gates ETF share and size observations to the next SSE session', () => {
    expect(researchDataContractById.get('cn.etf.share_size.daily')).toMatchObject({
      status: 'integrated',
      instrumentType: 'exchange_traded_fund_reference_observation',
      pointInTime: {
        availableDatePolicy: expect.stringContaining('strictly later SSE session'),
        macroVintagePolicy: expect.stringContaining('latest-value backfills'),
      },
      binding: {
        unit: 'totalShare=10k_fund_units;totalSize=10k_CNY',
      },
    });
  });
});
