import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TushareClient, type TushareValue } from '../providers/tushare/tushare-client.js';
import { syncChinaMacroData } from './china-macro.js';

const database = vi.hoisted(() => ({
  transaction: vi.fn(),
  calendar: vi.fn(),
  series: vi.fn(),
  schedule: vi.fn(),
  observations: vi.fn(),
  observation: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      $transaction: database.transaction,
      tradeCal: { findMany: database.calendar },
      macroSeries: { upsert: database.series },
      macroReleaseSchedule: { upsert: database.schedule },
      macroObservation: { findMany: database.observations, upsert: database.observation },
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

const sourceRows: TushareValue[][] = [
  ['202609', 50.1],
  ['202608', 49.8],
  ['202607', 49.2],
  ['202606', 50.3],
  ['202605', 50],
  ['202604', 50.3],
];

function sourceFixture(fields: string[], items: TushareValue[][]) {
  const fetchSource = vi.fn(async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(options.body as string);
    const pmi = request.api_name === 'cn_pmi';
    const correctFields = !pmi || request.fields === 'month,pmi010000';

    return Response.json({
      code: correctFields ? 0 : 50101,
      msg: correctFields ? '' : 'Requested fields do not match',
      data: correctFields ? { fields: pmi ? fields : [], items: pmi ? items : [] } : null,
    });
  });

  vi.stubGlobal('fetch', fetchSource);

  return fetchSource;
}

function synchronize() {
  return syncChinaMacroData(
    new TushareClient({ token: 'fixture', minIntervalMs: 0, maxRetries: 0 }),
    '202604',
    '202610',
    () => {},
    new Date('2026-10-19T03:00:00Z'),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  database.transaction.mockImplementation(async (operations) => Promise.all(operations));
  database.calendar.mockResolvedValue(
    ['20260507', '20260608', '20260707', '20260807', '20260907', '20261008'].map((calDate) => ({
      calDate,
    })),
  );
  database.observations.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('PMI source contract before persistence', () => {
  it('requests explicit lowercase fields and persists all six verified source observations', async () => {
    const fetchSource = sourceFixture(['month', 'pmi010000'], sourceRows);

    expect(await synchronize()).toMatchObject({ sourceRows: 6, insertedVintages: 6 });

    const requests = fetchSource.mock.calls.map(([, options]) =>
      JSON.parse(options.body as string),
    );
    expect(requests.find((request) => request.api_name === 'cn_pmi')).toMatchObject({
      params: { start_m: '202604', end_m: '202610' },
      fields: 'month,pmi010000',
    });
    expect(requests.find((request) => request.api_name === 'cn_cpi').fields).toBe('');
    expect(
      database.observation.mock.calls.map(([input]) => [input.create.period, input.create.value]),
    ).toEqual([...sourceRows].reverse());
  });

  it('accepts numeric strings and case-insensitive response columns without losing PMI values', async () => {
    sourceFixture(['MONTH', 'PMI010000'], [['202609', '50.1']]);

    await synchronize();

    expect(database.observation).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ period: '202609', value: 50.1 }),
      }),
    );
  });

  it.each([
    { name: 'missing PMI column', fields: ['month'], rows: [['202609']], error: /pmi010000/ },
    { name: 'missing month column', fields: ['pmi010000'], rows: [[50.1]], error: /invalid month/ },
    {
      name: 'empty result',
      fields: ['month', 'pmi010000'],
      rows: [],
      error: /no manufacturing PMI/,
    },
    {
      name: 'null value',
      fields: ['month', 'pmi010000'],
      rows: [['202609', null]],
      error: /pmi010000/,
    },
    {
      name: 'blank value',
      fields: ['month', 'pmi010000'],
      rows: [['202609', '  ']],
      error: /pmi010000/,
    },
    {
      name: 'non-numeric value',
      fields: ['month', 'pmi010000'],
      rows: [['202609', 'bad']],
      error: /pmi010000/,
    },
    {
      name: 'non-finite value',
      fields: ['month', 'pmi010000'],
      rows: [['202609', 'Infinity']],
      error: /pmi010000/,
    },
    {
      name: 'negative value',
      fields: ['month', 'pmi010000'],
      rows: [['202609', -1]],
      error: /pmi010000/,
    },
    {
      name: 'value above index range',
      fields: ['month', 'pmi010000'],
      rows: [['202609', 101]],
      error: /pmi010000/,
    },
    {
      name: 'invalid month',
      fields: ['month', 'pmi010000'],
      rows: [['202613', 50]],
      error: /invalid month/,
    },
    {
      name: 'month outside request',
      fields: ['month', 'pmi010000'],
      rows: [['202603', 50]],
      error: /outside/,
    },
    {
      name: 'duplicate month',
      fields: ['month', 'pmi010000'],
      rows: [
        ['202609', 50.1],
        ['202609', 50.2],
      ],
      error: /duplicate month/,
    },
  ])('rejects $name before any database writes', async ({ fields, rows, error }) => {
    sourceFixture(fields, rows as TushareValue[][]);

    await expect(synchronize()).rejects.toThrow(error);

    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.series).not.toHaveBeenCalled();
    expect(database.schedule).not.toHaveBeenCalled();
    expect(database.observation).not.toHaveBeenCalled();
  });
});
