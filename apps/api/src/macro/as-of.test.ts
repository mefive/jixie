import { describe, expect, it } from 'vitest';
import { selectMacroObservationsAsOf, type MacroObservationVintageRow } from './as-of.js';

const rows: MacroObservationVintageRow[] = [
  {
    seriesKey: 'cn_cpi_yoy',
    period: '202501',
    value: 0.4,
    releaseDate: '20250209',
    availableDate: '20250210',
    availabilityKind: 'official_schedule',
    vintageDate: '20250210',
    vintageKind: 'captured_as_available',
  },
  {
    seriesKey: 'cn_cpi_yoy',
    period: '202501',
    value: 0.5,
    releaseDate: '20250209',
    availableDate: '20250210',
    availabilityKind: 'official_schedule',
    vintageDate: '20250315',
    vintageKind: 'captured_as_available',
  },
  {
    seriesKey: 'cn_cpi_yoy',
    period: '202502',
    value: -0.7,
    releaseDate: '20250309',
    availableDate: '20250310',
    availabilityKind: 'official_schedule',
    vintageDate: '20260809',
    vintageKind: 'latest_value_backfill',
  },
];

describe('macro point-in-time selection', () => {
  it('hides an observation before its market availability date', () => {
    const snapshot = selectMacroObservationsAsOf(rows, {
      seriesKeys: ['cn_cpi_yoy'],
      decisionDate: '20250209',
      revisionPolicy: 'as_available',
    });

    expect(snapshot.observations).toEqual([]);
    expect(snapshot.disclosure.futureVintageRows).toBe(0);
  });

  it('uses only the revision captured by the historical decision date', () => {
    const snapshot = selectMacroObservationsAsOf(rows, {
      seriesKeys: ['cn_cpi_yoy'],
      decisionDate: '20250228',
      revisionPolicy: 'as_available',
    });

    expect(snapshot.observations).toHaveLength(1);
    expect(snapshot.observations[0]?.value).toBe(0.4);
    expect(snapshot.disclosure).toEqual({
      latestValueBackfillRows: 0,
      futureVintageRows: 0,
    });
  });

  it('labels latest-vintage research when it reads revisions captured in the future', () => {
    const snapshot = selectMacroObservationsAsOf(rows, {
      seriesKeys: ['cn_cpi_yoy'],
      decisionDate: '20250310',
      revisionPolicy: 'latest_vintage',
    });

    expect(snapshot.observations.map((row) => [row.period, row.value])).toEqual([
      ['202501', 0.5],
      ['202502', -0.7],
    ]);
    expect(snapshot.disclosure).toEqual({
      latestValueBackfillRows: 1,
      futureVintageRows: 2,
    });
  });

  it('applies a data cutoff to both strict and latest-vintage research', () => {
    const snapshot = selectMacroObservationsAsOf(rows, {
      seriesKeys: ['cn_cpi_yoy'],
      decisionDate: '20250320',
      revisionPolicy: 'latest_vintage',
      dataCutoff: '20250228',
    });

    expect(snapshot.observations.map((row) => row.value)).toEqual([0.4]);
    expect(snapshot.disclosure.futureVintageRows).toBe(0);
  });

  it('fails closed when a stored vintage predates its availability date', () => {
    expect(() =>
      selectMacroObservationsAsOf([{ ...rows[0]!, vintageDate: '20250207' }], {
        seriesKeys: ['cn_cpi_yoy'],
        decisionDate: '20250228',
        revisionPolicy: 'as_available',
      }),
    ).toThrow('Invalid macro observation');
  });
});
