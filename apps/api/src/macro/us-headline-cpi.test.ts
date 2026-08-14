import { describe, expect, it } from 'vitest';
import {
  BlsPublicDataClient,
  blsYearRanges,
  parseBlsBulkFile,
  parseOecdUsCpiCsv,
  parseUsHeadlineCpiRows,
  prepareUsHeadlineCpiObservations,
} from './us-headline-cpi.js';

function oecdCpiCsv({
  startPeriod = '2005-01',
  endPeriod = '2026-07',
  basePeriod = '2015',
  adjustment = 'N',
  omittedPeriods = ['2025-10'],
}: {
  startPeriod?: string;
  endPeriod?: string;
  basePeriod?: string;
  adjustment?: string;
  omittedPeriods?: string[];
} = {}): string {
  const header = [
    'DATASET_NAME',
    'REF_AREA',
    'FREQ',
    'METHODOLOGY',
    'MEASURE',
    'UNIT_MEASURE',
    'EXPENDITURE',
    'ADJUSTMENT',
    'TRANSFORMATION',
    'BASE_PER',
    'TIME_PERIOD',
    'OBS_VALUE',
  ].join(',');
  const rows: string[] = [];
  for (let period = startPeriod; period <= endPeriod; period = nextMonth(period)) {
    if (omittedPeriods.includes(period)) {
      continue;
    }
    rows.push(
      [
        '"Consumer price indices, national and harmonised"',
        'USA',
        'M',
        'N',
        'CPI',
        'IX',
        '_T',
        adjustment,
        '_Z',
        basePeriod,
        period,
        period === '2026-07' ? '101' : '100',
      ].join(','),
    );
  }
  return [header, ...rows].join('\r\n');
}

function nextMonth(period: string): string {
  const next = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

describe('US headline CPI normalization', () => {
  it('chunks public BLS requests into at most ten inclusive calendar years', () => {
    expect(blsYearRanges('200501', '202607')).toEqual([
      { startYear: 2005, endYear: 2014 },
      { startYear: 2015, endYear: 2024 },
      { startYear: 2025, endYear: 2026 },
    ]);
  });

  it('keeps monthly CPI-U index levels and skips annual averages or unavailable values', () => {
    expect(
      parseUsHeadlineCpiRows(
        [
          { year: '2025', period: 'M13', value: '320.000' },
          { year: '2025', period: 'M10', value: '-' },
          { year: '2025', period: 'M09', value: '324.800' },
          { year: '2024', period: 'M12', value: '315.605' },
        ],
        '202501',
        '202512',
      ),
    ).toEqual([{ period: '202509', value: 324.8 }]);
  });

  it('parses the exact series from the official tab-separated All Items file', () => {
    expect(
      parseBlsBulkFile(
        [
          'series_id\tyear\tperiod\tvalue\tfootnote_codes',
          'CUSR0000SA0      \t2025\tM01\t319.086\t',
          'CUUR0000SA0      \t2025\tM01\t317.671\t',
          'CUUR0000SA0      \t2025\tM13\t321.943\t',
        ].join('\n'),
        'CUUR0000SA0',
      ),
    ).toEqual([
      { year: '2025', period: 'M01', value: '317.671' },
      { year: '2025', period: 'M13', value: '321.943' },
    ]);
  });

  it('strictly parses OECD dimensions and restores the native BLS index scale', () => {
    expect(
      parseOecdUsCpiCsv(oecdCpiCsv({ startPeriod: '2026-06', endPeriod: '2026-07' }), '2026-06'),
    ).toEqual([
      { year: '2026', period: 'M06', value: '237.017' },
      { year: '2026', period: 'M07', value: '239.387' },
    ]);
  });

  it('fails closed when the OECD series has the wrong basis, adjustment, gaps, or staleness', () => {
    expect(() =>
      parseOecdUsCpiCsv(
        oecdCpiCsv({
          startPeriod: '2026-06',
          endPeriod: '2026-07',
          basePeriod: '2020',
        }),
        '2026-06',
      ),
    ).toThrow('BASE_PER=2020, expected 2015');
    expect(() =>
      parseOecdUsCpiCsv(
        oecdCpiCsv({
          startPeriod: '2026-06',
          endPeriod: '2026-07',
          adjustment: 'Y',
        }),
        '2026-06',
      ),
    ).toThrow('ADJUSTMENT=Y, expected N');
    expect(() =>
      parseOecdUsCpiCsv(
        oecdCpiCsv({
          startPeriod: '2026-05',
          endPeriod: '2026-07',
          omittedPeriods: ['2026-06'],
        }),
        '2026-05',
      ),
    ).toThrow('gap after 2026-05; expected 2026-06');
    expect(() =>
      parseOecdUsCpiCsv(oecdCpiCsv({ startPeriod: '2026-06', endPeriod: '2026-07' }), '2026-08'),
    ).toThrow('stale at 2026-07; expected at least 2026-08');
  });

  it('prefers the official unregistered GET signature with the requested year range', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({
        status: 'REQUEST_SUCCEEDED',
        Results: {
          series: [
            {
              seriesID: 'CUUR0000SA0',
              data: [{ year: '2025', period: 'M01', value: '317.671' }],
            },
          ],
        },
      });
    };

    await expect(
      new BlsPublicDataClient(fetchImpl).loadSeries('CUUR0000SA0', 2025, 2026),
    ).resolves.toEqual([{ year: '2025', period: 'M01', value: '317.671' }]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0?startyear=2025&endyear=2026',
    );
    expect(requests[0]?.init?.method).toBeUndefined();
    expect(requests[0]?.init?.headers).toMatchObject({
      'user-agent': 'jixie-research/1.0 (+https://github.com/mefive/jixie)',
    });
  });

  it('falls back once from rejected GET and POST APIs to the cached official bulk file', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes('publicAPI')) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(
        [
          'series_id\tyear\tperiod\tvalue\tfootnote_codes',
          'CUUR0000SA0      \t2014\tM12\t234.812\t',
          'CUUR0000SA0      \t2015\tM01\t233.707\t',
        ].join('\n'),
      );
    };
    const logs: string[] = [];
    const client = new BlsPublicDataClient(fetchImpl, (line) => logs.push(line));

    await expect(client.loadSeries('CUUR0000SA0', 2005, 2014)).resolves.toEqual([
      { year: '2014', period: 'M12', value: '234.812' },
    ]);
    await expect(client.loadSeries('CUUR0000SA0', 2015, 2024)).resolves.toEqual([
      { year: '2015', period: 'M01', value: '233.707' },
    ]);

    expect(requests).toHaveLength(3);
    expect(requests[0]?.url).toContain('api.bls.gov');
    expect(requests[0]?.init?.headers).toMatchObject({
      'user-agent': 'jixie-research/1.0 (+https://github.com/mefive/jixie)',
    });
    expect(requests[1]?.url).toContain('api.bls.gov');
    expect(requests[1]?.init?.method).toBe('POST');
    expect(requests[2]?.url).toContain('cu.data.1.AllItems');
    expect(logs).toEqual([
      'BLS GET API unavailable (returned HTTP 403); trying the official POST API',
      'BLS POST API unavailable (returned HTTP 403); falling back to the official All Items bulk file',
    ]);
  });

  it('falls back once to the cached official OECD series when all BLS domains are blocked', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes('sdmx.oecd.org')) {
        return new Response(oecdCpiCsv());
      }
      return new Response('Forbidden', { status: 403 });
    };
    const logs: string[] = [];
    const client = new BlsPublicDataClient(
      fetchImpl,
      (line) => logs.push(line),
      () => new Date('2026-08-14T00:00:00.000Z'),
    );

    const firstRange = await client.loadSeries('CUUR0000SA0', 2005, 2014);
    const lastRange = await client.loadSeries('CUUR0000SA0', 2025, 2026);

    expect(firstRange).toHaveLength(120);
    expect(firstRange[0]).toEqual({ year: '2005', period: 'M01', value: '237.017' });
    expect(lastRange).toHaveLength(18);
    expect(lastRange.at(-1)).toEqual({ year: '2026', period: 'M07', value: '239.387' });
    expect(requests).toHaveLength(4);
    expect(requests[0]?.url).toContain('api.bls.gov');
    expect(requests[1]?.url).toContain('api.bls.gov');
    expect(requests[2]?.url).toContain('download.bls.gov');
    expect(requests[3]?.url).toContain(
      'USA.M.N.CPI.IX._T.N._Z?startPeriod=2005-01&dimensionAtObservation=AllDimensions',
    );
    expect(logs).toEqual([
      'BLS GET API unavailable (returned HTTP 403); trying the official POST API',
      'BLS POST API unavailable (returned HTTP 403); falling back to the official All Items bulk file',
      'BLS bulk download unavailable (official All Items file returned HTTP 403); falling back to OECD national CPI SDMX',
      'OECD US CPI fallback loaded 258 monthly observations (200501..202607)',
    ]);
  });

  it('uses month-end plus twenty days and the next available SSE session', () => {
    expect(
      prepareUsHeadlineCpiObservations(
        [
          { period: '202601', value: 325.252 },
          { period: '202602', value: 326.785 },
        ],
        ['20260220', '20260320', '20260323'],
      ),
    ).toEqual([
      {
        seriesKey: 'us_cpi_u_all_items_nsa',
        period: '202601',
        value: 325.252,
        releaseDate: null,
        availableDate: '20260220',
        availabilityKind: 'conservative_lag',
      },
      {
        seriesKey: 'us_cpi_u_all_items_nsa',
        period: '202602',
        value: 326.785,
        releaseDate: null,
        availableDate: '20260320',
        availabilityKind: 'conservative_lag',
      },
    ]);
  });

  it('fails closed on duplicate periods or malformed numeric values', () => {
    expect(() =>
      parseUsHeadlineCpiRows(
        [
          { year: '2025', period: 'M01', value: '317.671' },
          { year: '2025', period: 'M01', value: '317.672' },
        ],
        '202501',
        '202501',
      ),
    ).toThrow('duplicate period 202501');
    expect(() =>
      parseUsHeadlineCpiRows(
        [{ year: '2025', period: 'M01', value: 'not-a-number' }],
        '202501',
        '202501',
      ),
    ).toThrow('invalid value');
  });
});
