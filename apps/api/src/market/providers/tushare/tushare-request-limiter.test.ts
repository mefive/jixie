import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TushareRequestLimiter } from './tushare-request-limiter.js';
import { MarketSyncBudgetError } from '../../errors.js';

afterEach(() => vi.useRealTimers());
const options = { token: 'test-only-secret', concurrency: 2, minIntervalMs: 800, perMinute: 75 };

it('spaces request starts while allowing the first response to remain in flight', async () => {
  vi.useFakeTimers();
  const limiter = new TushareRequestLimiter(options);
  const first = await limiter.acquire('daily');
  let ready = false;
  const second = limiter.acquire('dividend').then((release) => {
    ready = true;
    return release;
  });
  await vi.advanceTimersByTimeAsync(799);
  expect(ready).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const releaseSecond = await second;
  expect(ready).toBe(true);
  first();
  releaseSecond();
  await limiter.close();
});

it('counts every admitted request against one rolling global window', async () => {
  vi.useFakeTimers();
  const limiter = new TushareRequestLimiter({ ...options, minIntervalMs: 1, perMinute: 2 });
  (await limiter.acquire('daily'))();
  await vi.advanceTimersByTimeAsync(1);
  (await limiter.acquire('dividend'))();
  let ready = false;
  const third = limiter.acquire('daily').then((release) => {
    ready = true;
    return release;
  });
  await vi.advanceTimersByTimeAsync(59_998);
  expect(ready).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  (await third)();
  await limiter.close();
});

it('enforces the connection cap and allows cancellable API-specific waits', async () => {
  vi.useFakeTimers();
  const limiter = new TushareRequestLimiter({
    ...options,
    minIntervalMs: 1,
    apiLimits: { daily: { perMinute: 1 } },
  });
  const first = await limiter.acquire('daily');
  const controller = new AbortController();
  const waiting = limiter.acquire('daily', controller.signal);
  const rejected = expect(waiting).rejects.toBeInstanceOf(MarketSyncBudgetError);
  await vi.advanceTimersByTimeAsync(1);
  const second = await limiter.acquire('dividend');
  let thirdReady = false;
  const third = limiter.acquire('index_daily').then((release) => {
    thirdReady = true;
    return release;
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(thirdReady).toBe(false);
  first();
  await vi.advanceTimersByTimeAsync(50);
  (await third)();
  second();
  controller.abort();
  await rejected;
  await limiter.close();
});

it('persists daily reservations across restart and excludes token plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-quota-test-'));
  const config = {
    ...options,
    quotaDirectory: directory,
    minIntervalMs: 1,
    apiLimits: { daily: { perMinute: 10, perDay: 1 } },
  };
  const first = new TushareRequestLimiter(config);
  let restarted: TushareRequestLimiter | undefined;
  try {
    (await first.acquire('daily'))();
    await first.close();
    const files = await readdir(directory);
    const journal = await readFile(
      join(directory, files.find((name) => name.endsWith('.jsonl'))!),
      'utf8',
    );
    expect(journal).not.toContain(options.token);
    restarted = new TushareRequestLimiter(config);
    await restarted.ready();
    const controller = new AbortController();
    let admitted = false;
    const waiting = restarted.acquire('daily', controller.signal).then((release) => {
      admitted = true;
      return release;
    });
    const rejected = expect(waiting).rejects.toBeInstanceOf(MarketSyncBudgetError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(admitted).toBe(false);
    controller.abort();
    await rejected;
  } finally {
    await first.close();
    await restarted?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('refuses a second sender with the same token until the owner closes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-quota-owner-'));
  const first = new TushareRequestLimiter({ ...options, quotaDirectory: directory });
  const second = new TushareRequestLimiter({ ...options, quotaDirectory: directory });
  try {
    await first.ready();
    await expect(second.ready()).rejects.toThrow('ownership');
  } finally {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});
