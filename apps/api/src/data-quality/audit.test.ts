import { describe, expect, it } from 'vitest';
import {
  analyzeCalendarCoverage,
  findSharpRowCountDrops,
  selectEvaluationDates,
  summarizeCrossMarketBenchmarkPit,
  summarizeExternalMarketPit,
  summarizeFinancialStatementVersions,
  summarizeCreditCurvePit,
  summarizeMacroPit,
  summarizeWindowCoverage,
} from './audit.js';

describe('data quality audit helpers', () => {
  it('separates leading, internal, and trailing calendar gaps', () => {
    const result = analyzeCalendarCoverage(
      ['20260102', '20260105', '20260106', '20260107', '20260108'],
      [
        { tradeDate: '20260105', count: 100 },
        { tradeDate: '20260107', count: 110 },
      ],
    );

    expect(result.leadingMissingDates).toEqual(['20260102']);
    expect(result.internalMissingDates).toEqual(['20260106']);
    expect(result.trailingMissingDates).toEqual(['20260108']);
    expect(result.observedStart).toBe('20260105');
    expect(result.observedEnd).toBe('20260107');
  });

  it('detects a sharp row-count drop against the prior rolling median', () => {
    const stable = Array.from({ length: 20 }, (_, index) => ({
      tradeDate: `202601${String(index + 1).padStart(2, '0')}`,
      count: index % 2 === 0 ? 100 : 102,
    }));

    expect(
      findSharpRowCountDrops([
        ...stable,
        { tradeDate: '20260121', count: 60 },
        { tradeDate: '20260122', count: 100 },
      ]),
    ).toEqual([{ tradeDate: '20260121', count: 60, referenceMedian: 101 }]);
  });

  it('selects evaluation dates across the full history', () => {
    const dates = [
      '20200131',
      '20201231',
      '20211231',
      '20221230',
      '20231229',
      '20241231',
      '20250725',
    ];

    expect(selectEvaluationDates(dates, 3)).toEqual(['20201231', '20231229', '20250725']);
    expect(selectEvaluationDates(dates, 1)).toEqual(['20250725']);
  });

  it('summarizes effective observations against trading days', () => {
    const result = summarizeWindowCoverage('20261231', '20261001', 60, [
      { tsCode: '000001.SZ', observedDays: 60 },
      { tsCode: '000002.SZ', observedDays: 45 },
      { tsCode: '000003.SZ', observedDays: 30 },
    ]);

    expect(result.eligibleStocks).toBe(3);
    expect(result.medianCoverage).toBe(0.75);
    expect(result.tenthPercentileCoverage).toBeCloseTo(0.55);
    expect(result.belowMinimumCount).toBe(1);
  });

  it('audits macro availability evidence and vintage disclosure', () => {
    const result = summarizeMacroPit(
      ['cn_pmi_manufacturing', 'cn_cpi_yoy'],
      [
        {
          seriesKey: 'cn_pmi_manufacturing',
          period: '202601',
          releaseDate: '20260201',
          availableDate: '20260202',
          availabilityKind: 'official_schedule',
          vintageKind: 'captured_as_available',
        },
        {
          seriesKey: 'cn_cpi_yoy',
          period: '202601',
          releaseDate: null,
          availableDate: '20260221',
          availabilityKind: 'conservative_lag',
          vintageKind: 'latest_value_backfill',
        },
        {
          seriesKey: 'cn_cpi_yoy',
          period: '202602',
          releaseDate: '20260310',
          availableDate: '20260309',
          availabilityKind: 'official_schedule',
          vintageKind: 'captured_as_available',
        },
      ],
      new Set(['20260202', '20260309']),
    );

    expect(result).toEqual({
      missingSeries: [
        'cn_ppi_yoy',
        'cn_m1_balance',
        'cn_m1_yoy',
        'cn_m2_balance',
        'cn_m2_yoy',
        'cn_social_financing_increment',
        'cn_social_financing_stock',
        'cn_shibor_overnight',
        'cn_shibor_1w',
        'cn_shibor_1m',
        'cn_shibor_3m',
        'us_cpi_u_all_items_nsa',
      ],
      invalidAvailabilityRows: 1,
      nonTradingAvailabilityRows: 1,
      conservativeLagRows: 1,
      latestValueBackfillRows: 1,
      capturedAsAvailableRows: 2,
    });
  });

  it('reports statement PIT violations separately from legacy indicator coverage', () => {
    expect(
      summarizeFinancialStatementVersions(
        {
          total: 300,
          invalidAnnouncementDate: 0,
          invalidAvailableDate: 1,
          invalidQuality: 0,
          invalidReportScope: 0,
        },
        {
          indicatorPeriods: 100,
          incomeMatches: 98,
          balanceMatches: 96,
          cashFlowMatches: 95,
        },
      ),
    ).toMatchObject({
      id: 'financial-statement-versions',
      status: 'error',
      summary: expect.stringContaining('1 invalid PIT or scope fields'),
    });

    expect(
      summarizeFinancialStatementVersions(
        {
          total: 300,
          invalidAnnouncementDate: 0,
          invalidAvailableDate: 0,
          invalidQuality: 0,
          invalidReportScope: 0,
        },
        {
          indicatorPeriods: 100,
          incomeMatches: 98,
          balanceMatches: 96,
          cashFlowMatches: 95,
        },
      ).status,
    ).toBe('pass');
  });

  it('audits external drivers against the next China market session', () => {
    expect(
      summarizeExternalMarketPit(
        [
          {
            seriesKey: 'us_treasury_nominal',
            tradeDate: '20260730',
            availableDate: '20260731',
            validValue: true,
          },
          {
            seriesKey: 'us_treasury_real',
            tradeDate: '20260731',
            availableDate: '20260803',
            validValue: true,
          },
          {
            seriesKey: 'USDCNH.FXCM',
            tradeDate: '20260730',
            availableDate: '20260730',
            validValue: false,
          },
          {
            seriesKey: 'USDHKD.FXCM',
            tradeDate: '20260730',
            availableDate: '20260731',
            validValue: true,
          },
        ],
        new Set(['20260731', '20260803']),
      ),
    ).toEqual({
      missingSeries: [],
      invalidAvailabilityRows: 1,
      nonTradingAvailabilityRows: 1,
      invalidValueRows: 1,
      latestAvailableDate: '20260803',
    });
  });

  it('audits each required China credit curve independently', () => {
    expect(
      summarizeCreditCurvePit(
        [
          {
            seriesKey: 'chinabond_cgb_ytm',
            tradeDate: '20260730',
            availableDate: '20260731',
            validValue: true,
          },
          {
            seriesKey: 'chinabond_bank_aaa_ytm',
            tradeDate: '20260729',
            availableDate: '20260730',
            validValue: true,
          },
        ],
        new Set(['20260730', '20260731']),
        '20260731',
      ),
    ).toEqual({
      missingSeries: ['chinabond_cp_note_aaa_ytm'],
      invalidAvailabilityRows: 0,
      nonTradingAvailabilityRows: 0,
      invalidValueRows: 0,
      latestAvailableDate: '20260731',
      staleSeries: ['chinabond_bank_aaa_ytm'],
    });
  });

  it('applies the local-close and strictly-later cross-market availability rules separately', () => {
    expect(
      summarizeCrossMarketBenchmarkPit(
        [
          {
            benchmarkId: 'equity.cn.csi300.price',
            market: 'CN',
            tradeDate: '20260730',
            availableDate: '20260730',
            close: 4500,
          },
          {
            benchmarkId: 'equity.hk.hsi.price',
            market: 'HK',
            tradeDate: '20260730',
            availableDate: '20260731',
            close: 25000,
          },
          {
            benchmarkId: 'equity.us.spx.price',
            market: 'US',
            tradeDate: '20260730',
            availableDate: '20260731',
            close: 7000,
          },
        ],
        new Set(['20260730', '20260731']),
      ),
    ).toEqual({
      missingBenchmarks: [],
      invalidAvailabilityRows: 0,
      nonTradingAvailabilityRows: 0,
      invalidValueRows: 0,
      latestAvailableByBenchmark: {
        'equity.cn.csi300.price': '20260730',
        'equity.hk.hsi.price': '20260731',
        'equity.us.spx.price': '20260731',
      },
    });
  });
});
