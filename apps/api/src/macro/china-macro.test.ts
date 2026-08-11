import { describe, expect, it } from 'vitest';
import {
  CHINA_MACRO_SERIES,
  chinaMacroSourceRequests,
  macroVintageKind,
  parseMacroScheduleRows,
  prepareMacroObservations,
} from './china-macro.js';

describe('China macro PIT normalization', () => {
  it('uses monthly source ranges and year-bounded Shibor requests', () => {
    expect(chinaMacroSourceRequests('202512', '202601')).toEqual([
      { sourceApi: 'cn_pmi', params: { start_m: '202512', end_m: '202601' } },
      { sourceApi: 'cn_cpi', params: { start_m: '202512', end_m: '202601' } },
      { sourceApi: 'cn_ppi', params: { start_m: '202512', end_m: '202601' } },
      { sourceApi: 'cn_m', params: { start_m: '202512', end_m: '202601' } },
      { sourceApi: 'sf_month', params: { start_m: '202512', end_m: '202601' } },
      {
        sourceApi: 'shibor',
        params: { start_date: '20251201', end_date: '20251231' },
      },
      {
        sourceApi: 'shibor',
        params: { start_date: '20260101', end_date: '20260131' },
      },
    ]);
  });

  it('maps official schedules to observation periods and the first tradable availability date', () => {
    const manufacturingPmi = CHINA_MACRO_SERIES.find(
      (definition) => definition.seriesKey === 'cn_pmi_manufacturing',
    )!;
    const schedules = parseMacroScheduleRows([
      {
        month: '202601',
        publish_date: '20260131',
        title: '采购经理指数月度报告',
        issuing_org: '国家统计局',
        data_api: 'cn_pmi',
      },
      {
        month: '202603',
        publish_date: '20260304',
        title: '采购经理指数月度报告',
        issuing_org: '国家统计局',
        data_api: 'cn_pmi',
      },
    ]);

    expect(
      prepareMacroObservations(
        manufacturingPmi,
        [
          { MONTH: '202601', PMI010000: 49.3 },
          { MONTH: '202602', PMI010000: 49 },
        ],
        schedules,
        ['20260202', '20260304'],
      ),
    ).toEqual([
      {
        seriesKey: 'cn_pmi_manufacturing',
        period: '202601',
        value: 49.3,
        releaseDate: '20260131',
        availableDate: '20260202',
        availabilityKind: 'official_schedule',
      },
      {
        seriesKey: 'cn_pmi_manufacturing',
        period: '202602',
        value: 49,
        releaseDate: '20260304',
        availableDate: '20260304',
        availabilityKind: 'official_schedule',
      },
    ]);
  });

  it('uses explicit conservative lags without inventing historical release dates', () => {
    const manufacturingPmi = CHINA_MACRO_SERIES.find(
      (definition) => definition.seriesKey === 'cn_pmi_manufacturing',
    )!;
    const cpi = CHINA_MACRO_SERIES.find((definition) => definition.seriesKey === 'cn_cpi_yoy')!;
    const openDates = ['20250207', '20250220'];

    expect(
      prepareMacroObservations(
        manufacturingPmi,
        [{ month: '202501', pmi010000: 49.1 }],
        [],
        openDates,
      )[0],
    ).toMatchObject({
      releaseDate: null,
      availableDate: '20250207',
      availabilityKind: 'conservative_lag',
    });
    expect(
      prepareMacroObservations(cpi, [{ month: '202501', nt_yoy: -0.7 }], [], openDates)[0],
    ).toMatchObject({
      releaseDate: null,
      availableDate: '20250220',
      availabilityKind: 'conservative_lag',
    });
  });

  it('normalizes PBoC money and credit values with explicit units and conservative availability', () => {
    const m1 = CHINA_MACRO_SERIES.find((definition) => definition.seriesKey === 'cn_m1_balance')!;
    const socialFinancing = CHINA_MACRO_SERIES.find(
      (definition) => definition.seriesKey === 'cn_social_financing_stock',
    )!;

    expect(m1).toMatchObject({ unit: '100m_cny', domain: 'liquidity', sourceApi: 'cn_m' });
    expect(socialFinancing).toMatchObject({
      unit: 'trillion_cny',
      domain: 'credit',
      sourceApi: 'sf_month',
    });
    expect(
      prepareMacroObservations(m1, [{ month: '202606', m1: 1_184_775.53 }], [], ['20260720'])[0],
    ).toEqual({
      seriesKey: 'cn_m1_balance',
      period: '202606',
      value: 1_184_775.53,
      releaseDate: null,
      availableDate: '20260720',
      availabilityKind: 'conservative_lag',
    });
  });

  it('makes an intraday Shibor fixing available on the same SSE trading day', () => {
    const shibor = CHINA_MACRO_SERIES.find(
      (definition) => definition.seriesKey === 'cn_shibor_1w',
    )!;

    expect(
      prepareMacroObservations(
        shibor,
        [
          { date: '20260731', '1w': 1.453 },
          { date: '20260801', '1w': 1.454 },
        ],
        [],
        ['20260731', '20260803'],
      ),
    ).toEqual([
      {
        seriesKey: 'cn_shibor_1w',
        period: '20260731',
        value: 1.453,
        releaseDate: '20260731',
        availableDate: '20260731',
        availabilityKind: 'published_intraday',
      },
      {
        seriesKey: 'cn_shibor_1w',
        period: '20260801',
        value: 1.454,
        releaseDate: '20260801',
        availableDate: '20260803',
        availabilityKind: 'published_intraday',
      },
    ]);
  });

  it('labels final-value historical imports separately from near-release captures', () => {
    expect(macroVintageKind('20260610', '20260710')).toBe('captured_as_available');
    expect(macroVintageKind('20200120', '20260809')).toBe('latest_value_backfill');
  });

  it('rejects duplicate source periods instead of silently choosing one row', () => {
    const cpi = CHINA_MACRO_SERIES.find((definition) => definition.seriesKey === 'cn_cpi_yoy')!;
    expect(() =>
      prepareMacroObservations(
        cpi,
        [
          { month: '202501', nt_yoy: 0.5 },
          { month: '202501', nt_yoy: 0.6 },
        ],
        [],
        ['20250220'],
      ),
    ).toThrow('duplicate month 202501');
  });
});
