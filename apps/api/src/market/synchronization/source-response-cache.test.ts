import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceResponseCache, SourceResponseBudget } from './source-response-cache.js';
import { fetchSourcePages, withoutSourceRowAccumulation } from './source.js';
import type { SourceMeasurements } from '../providers/source-fetch.js';

const measurements = (): SourceMeasurements => ({
  httpRequests: 0,
  retries: 0,
  rateLimitMs: 0,
  sourceStartedAt: null,
  sourceFinishedAt: null,
});

it('spills a response without changing its request or reissuing HTTP during replay', async () => {
  const id = randomUUID().replaceAll('-', '');
  const source = { call: vi.fn().mockResolvedValue([{ name: 'Fixture' }]) };
  const budget = new SourceResponseBudget(1);
  const cache = new SourceResponseCache(budget, id);
  const stats = measurements();
  try {
    await cache
      .record(source, stats, () => new Date('2026-11-07T00:00:00Z'))
      .call('namechange', { start_date: '20000101', end_date: '20221001' }, 'name');
    expect(budget.bytes).toBe(0);
    expect(
      await cache
        .replay()
        .call('namechange', { end_date: '20221001', start_date: '20000101' }, 'name'),
    ).toEqual([{ name: 'Fixture' }]);
    expect(source.call).toHaveBeenCalledTimes(1);
    expect(stats.httpRequests).toBe(1);
    await expect(cache.replay().call('other')).rejects.toThrow('does not match');
  } finally {
    await cache.dispose();
  }
  expect((await readdir(tmpdir())).some((name) => name.startsWith(`jixie-source-${id}-`))).toBe(
    false,
  );
});

it('downloads pagination without retaining accumulated rows and reconstructs the complete batch later', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ name: `Name ${index}` }));
  const source = { call: vi.fn(async (_api, params) => (Number(params.offset ?? 0) ? [] : rows)) };
  const budget = new SourceResponseBudget(1024 * 1024);
  const cache = new SourceResponseCache(budget);
  const params = { start_date: '20000101', end_date: '20221001' };
  try {
    const downloaded = await withoutSourceRowAccumulation(() =>
      fetchSourcePages(
        cache.record(source, measurements(), () => new Date()),
        'namechange',
        params,
        'name',
      ),
    );
    expect(downloaded).toMatchObject({ complete: true, pages: 2, rows: [] });
    const replayed = await fetchSourcePages(cache.replay(), 'namechange', params, 'name');
    expect(replayed.rows).toEqual(rows);
    expect(source.call).toHaveBeenCalledTimes(2);
  } finally {
    await cache.dispose();
  }
  expect(budget.bytes).toBe(0);
});

it('replays a source failure without changing its error identity', async () => {
  const error = new Error('Controlled transport failure');
  const source = { call: vi.fn().mockRejectedValue(error) };
  const cache = new SourceResponseCache(new SourceResponseBudget(100));
  try {
    await expect(cache.record(source, measurements(), () => new Date()).call('daily')).rejects.toBe(
      error,
    );
    await expect(cache.replay().call('daily')).rejects.toBe(error);
    expect(source.call).toHaveBeenCalledTimes(1);
  } finally {
    await cache.dispose();
  }
});

it("reclaims only the stopped run's private orphan response directories", async () => {
  const id = randomUUID().replaceAll('-', '');
  const own = await mkdtemp(join(tmpdir(), `jixie-source-${id}-`));
  const other = await mkdtemp(join(tmpdir(), 'jixie-source-other-'));
  try {
    await writeFile(join(own, '0.json'), '[]');
    await writeFile(join(other, '0.json'), '[]');
    await SourceResponseCache.reclaim(id);
    await expect(readdir(own)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(other)).toEqual(['0.json']);
  } finally {
    await rm(own, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
