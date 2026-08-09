import { describe, expect, it } from 'vitest';
import {
  CHINA_MACRO_SERIES,
  macroVintageKind,
  parseMacroScheduleRows,
  prepareMacroObservations,
} from './china-macro.js';

describe('China macro PIT normalization', () => {
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
