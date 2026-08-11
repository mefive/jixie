import { describe, expect, it } from 'vitest';
import type { CommodityHoldingRepresentative } from './commodity-holding-positions.js';
import {
  summarizeCommodityHoldingQuality,
  type CommodityHoldingQualityRow,
} from './commodity-holding-quality.js';

describe('commodity holding quality', () => {
  it('passes complete PIT-safe ranked aggregates', () => {
    const representatives = [representative('AU'), representative('CU'), representative('M')];
    const rows = representatives.map((item) => qualityRow(item));

    const summary = summarizeCommodityHoldingQuality(rows, representatives, new Set(['20250702']));

    expect(summary.status).toBe('pass');
    expect(summary.invalidRows).toBe(0);
    expect(summary.products.every((product) => product.coverage === 1)).toBe(true);
  });

  it('errors on future leakage, wrong representative, and missing product coverage', () => {
    const representatives = [representative('AU'), representative('CU'), representative('M')];
    const rows = [
      qualityRow(representatives[0]!, {
        availableDate: '20250701',
        referenceContract: 'AU2512.SHF',
      }),
      qualityRow(representatives[1]!),
    ];

    const summary = summarizeCommodityHoldingQuality(rows, representatives, new Set(['20250702']));

    expect(summary.status).toBe('error');
    expect(summary.invalidRows).toBe(1);
    expect(summary.products.find((product) => product.productCode === 'M')?.observedDates).toBe(0);
  });
});

function representative(productCode: 'AU' | 'CU' | 'M'): CommodityHoldingRepresentative {
  const suffix = productCode === 'M' ? 'DCE' : 'SHF';
  const exchange = productCode === 'M' ? 'DCE' : 'SHFE';
  return {
    productCode,
    exchange,
    tsCode: `${productCode}2508.${suffix}`,
    sourceSymbol: `${productCode}2508`,
    tradeDate: '20250701',
    openInterest: 1_000,
    volume: 2_000,
  };
}

function qualityRow(
  representative: CommodityHoldingRepresentative,
  overrides: Partial<CommodityHoldingQualityRow> = {},
): CommodityHoldingQualityRow {
  return {
    version: 1,
    source: 'tushare_fut_holding',
    productCode: representative.productCode,
    tradeDate: representative.tradeDate,
    availableDate: '20250702',
    exchange: representative.exchange,
    referenceContract: representative.tsCode,
    sourceSymbol: representative.sourceSymbol,
    selectionMethod: 'max_open_interest_v1',
    contractOpenInterest: representative.openInterest,
    contractVolume: representative.volume,
    rankedVolume: 500,
    rankedVolumeChange: 5,
    rankedLongHolding: 600,
    rankedLongChange: 10,
    rankedShortHolding: 550,
    rankedShortChange: -5,
    topFiveLongHolding: 300,
    topFiveShortHolding: 280,
    volumeMemberCount: 20,
    longMemberCount: 20,
    shortMemberCount: 20,
    sourceRowCount: 35,
    excludedSummaryRowCount: 0,
    sourceCorrectionApplied: false,
    ...overrides,
  };
}
