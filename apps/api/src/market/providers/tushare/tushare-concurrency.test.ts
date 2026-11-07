import { setTimeout as realDelay } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { TushareClient } from './tushare-client.js';
import {
  withSourceMeasurements,
  withSourceRequestBudget,
  type SourceMeasurements,
} from '../source-fetch.js';
import { MarketSyncBudgetError, TushareError } from '../../errors.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const response = () =>
  new Response(
    JSON.stringify({ code: 0, msg: null, data: { fields: ['ts_code'], items: [['600000.SH']] } }),
    { headers: { 'content-type': 'application/json' } },
  );

it('overlaps response waits while retaining a shared start interval', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  let completeFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    completeFirst = resolve;
  });
  const fetcher = vi
    .fn()
    .mockImplementationOnce(() => firstResponse)
    .mockImplementation(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetcher);
  const client = new TushareClient({ token: 'fixture', concurrency: 2, minIntervalMs: 800 });
  const first = client.call('daily', {}, 'ts_code');
  const second = client.call('dividend', {}, 'ts_code');
  await vi.advanceTimersByTimeAsync(799);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await second).toEqual([{ ts_code: '600000.SH' }]);
  completeFirst(response());
  await first;
  await client.close();
});

it('shares Retry-After cooldown and counts the retry as a second HTTP request', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
    .mockImplementation(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetcher);
  const stats: SourceMeasurements = {
    httpRequests: 0,
    retries: 0,
    rateLimitMs: 0,
    sourceStartedAt: null,
    sourceFinishedAt: null,
  };
  const client = new TushareClient({
    token: 'fixture',
    concurrency: 2,
    minIntervalMs: 1,
    maxRetries: 1,
  });
  const result = withSourceRequestBudget({ remaining: Infinity, deadline: Infinity }, () =>
    withSourceMeasurements(stats, () => client.call('daily', {}, 'ts_code')),
  );
  await vi.advanceTimersByTimeAsync(0);
  // node:timers/promises 的退避使用真实时钟，先让它结束，再推进虚拟配额窗口。
  // Finish the native promise timer before advancing the virtual admission window.
  await realDelay(5);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(stats).toMatchObject({ httpRequests: 2, retries: 1 });
  expect(stats.rateLimitMs).toBeGreaterThan(1000);
  await client.close();
});

it('cancels cooldown without an extra request and never retries a permission rejection', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const client = new TushareClient({ token: 'fixture', minIntervalMs: 1, maxRetries: 2 });
  const pending = withSourceRequestBudget(
    { remaining: Infinity, deadline: Infinity, signal: controller.signal },
    () => client.call('daily', {}, 'ts_code'),
  );
  const rejected = expect(pending).rejects.toBeInstanceOf(MarketSyncBudgetError);
  await vi.advanceTimersByTimeAsync(5);
  controller.abort();
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
  await client.close();
  fetcher
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 40203, msg: 'permission denied', data: null })),
      ),
    );
  const denied = new TushareClient({ token: 'fixture', minIntervalMs: 1, maxRetries: 2 });
  await expect(denied.call('daily')).rejects.toBeInstanceOf(TushareError);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await denied.close();
});
