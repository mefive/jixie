import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-market-boundary-');
  writeFileSync(`${fixture.directory}/test.db`, '');
  return {
    prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${fixture.directory}/test.db` }),
  };
});

import { prisma } from '#infra/database/prisma.js';
import { TushareClient } from '../providers/tushare/client.js';
import { getOpenDates } from './read.js';
import { syncTradeCal } from './sync.js';
import { isCompletedShanghaiDate, latestCompletedTradeDate } from './sse-close.js';
import { signalCalendar } from '#signals/runs/readiness.js';

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'db',
      'push',
      '--skip-generate',
      '--schema',
      resolve('prisma/schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/test.db` }, stdio: 'pipe' },
  );
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  await rm(fixture.directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.tradeCal.deleteMany();
  await prisma.tradeCal.createMany({
    data: [
      { exchange: 'SSE', calDate: '20260911', isOpen: 1 },
      { exchange: 'SSE', calDate: '20260912', isOpen: 0 },
      { exchange: 'SSE', calDate: '20260914', isOpen: 1 },
      { exchange: 'SSE', calDate: '20260915', isOpen: 1 },
      { exchange: 'SZSE', calDate: '20260913', isOpen: 1 },
    ],
  });
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared SSE calendar and signal dates', () => {
  it.each([
    ['2026-09-14T07:59:59Z', '20260911', false],
    ['2026-09-14T08:00:00Z', '20260914', true],
    ['2026-09-13T10:00:00Z', '20260911', false],
    ['2026-09-14T16:00:00Z', '20260914', true],
  ])('keeps the Shanghai cutoff and SSE scope at %s', async (now, expected, todayCompleted) => {
    vi.setSystemTime(new Date(now));
    expect(await latestCompletedTradeDate()).toBe(expected);
    expect(isCompletedShanghaiDate('20260914')).toBe(todayCompleted);
  });

  it('preserves the consumer requirement for an open day and a known next trading day', async () => {
    vi.setSystemTime(new Date('2026-09-14T07:59:59Z'));
    expect(await signalCalendar('20260914')).toEqual({ kind: 'invalid_date' });
    vi.setSystemTime(new Date('2026-09-14T08:00:00Z'));
    expect(await signalCalendar('20260914')).toEqual({ kind: 'ready', execDate: '20260915' });
    expect(await signalCalendar('20260912')).toEqual({ kind: 'invalid_date' });
    expect(await signalCalendar('invalid')).toEqual({ kind: 'invalid_date' });
    vi.setSystemTime(new Date('2026-09-15T08:00:00Z'));
    expect(await signalCalendar('20260915')).toEqual({ kind: 'next_date_missing' });
  });

  it('returns no completed date when the SSE calendar is empty', async () => {
    await prisma.tradeCal.deleteMany({ where: { exchange: 'SSE' } });
    expect(await latestCompletedTradeDate()).toBeNull();
  });

  it('replaces only the requested exchange range and remains idempotent', async () => {
    const client = new TushareClient({ token: 'fixture' });
    const rows = [
      { exchange: 'SSE', cal_date: '20260914', is_open: 0, pretrade_date: '20260911' },
      { exchange: 'SSE', cal_date: '20260915', is_open: 1, pretrade_date: '20260911' },
    ];
    vi.spyOn(client, 'call').mockResolvedValue(rows);
    expect(await syncTradeCal(client, '20260914', '20260915')).toBe(2);
    const published = await prisma.tradeCal.findMany({
      orderBy: [{ exchange: 'asc' }, { calDate: 'asc' }],
    });
    expect(await syncTradeCal(client, '20260914', '20260915')).toBe(2);
    expect(
      await prisma.tradeCal.findMany({ orderBy: [{ exchange: 'asc' }, { calDate: 'asc' }] }),
    ).toEqual(published);
    expect(await getOpenDates('20260911', '20260915')).toEqual(['20260911', '20260915']);
    expect(await getOpenDates('20260911', '20260915', 'SZSE')).toEqual(['20260913']);
  });

  it('rolls back the range deletion when replacement rows cannot be inserted', async () => {
    const client = new TushareClient({ token: 'fixture' });
    const row = { exchange: 'SSE', cal_date: '20260914', is_open: 0, pretrade_date: '20260911' };
    vi.spyOn(client, 'call').mockResolvedValue([row, row]);
    const before = await prisma.tradeCal.findMany({
      orderBy: [{ exchange: 'asc' }, { calDate: 'asc' }],
    });
    await expect(syncTradeCal(client, '20260914', '20260915')).rejects.toThrow();
    expect(
      await prisma.tradeCal.findMany({ orderBy: [{ exchange: 'asc' }, { calDate: 'asc' }] }),
    ).toEqual(before);
  });
});
