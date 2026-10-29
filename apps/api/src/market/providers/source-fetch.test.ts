import { describe, expect, it } from 'vitest';
import {
  fetchMarketSource,
  readMarketSourceBytes,
  readMarketSourceText,
  withSourceRequestBudget,
} from './source-fetch.js';
import { HttpStatusError, isMarketSourceFailure, MarketSourceDownloadError } from '../errors.js';

describe('structured source failures', () => {
  it('retains transport failures and preserves their cause', async () => {
    const cause = new Error('offline');
    const fetcher: typeof fetch = async () => {
      throw cause;
    };
    await expect(fetchMarketSource(fetcher, 'https://example.invalid')).rejects.toMatchObject({
      name: 'MarketSourceDownloadError',
      cause,
    });
  });

  it('does not disguise parsing or mapping failures as network errors', async () => {
    const response = await fetchMarketSource(
      async () => new Response('invalid-json'),
      'https://example.invalid',
    );
    const body = await readMarketSourceText(response);
    expect(() => JSON.parse(body)).toThrow(SyntaxError);
    expect(isMarketSourceFailure(new Error('HTTP 503 offline'))).toBe(false);
    expect(
      isMarketSourceFailure(
        new AggregateError([
          new HttpStatusError(503, 'unavailable'),
          new MarketSourceDownloadError('offline'),
        ]),
      ),
    ).toBe(true);
    expect(
      isMarketSourceFailure(
        new AggregateError([
          new HttpStatusError(503, 'unavailable'),
          new SyntaxError('invalid mapping'),
        ]),
      ),
    ).toBe(false);
  });

  it.each([readMarketSourceText, readMarketSourceBytes])(
    'retains interrupted response bodies as download failures',
    async (readBody) => {
      const cause = new Error('connection reset while receiving');
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.error(cause);
          },
        }),
      );

      await expect(readBody(response)).rejects.toMatchObject({
        name: 'MarketSourceDownloadError',
        cause,
      });
    },
  );
});

it('counts every actual request and refuses exhausted, expired or cancelled budgets before fetching', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return new Response('retryable', { status: 503 });
  };
  const budget = { remaining: 2, deadline: Date.now() + 30_000 };
  await withSourceRequestBudget(budget, async () => {
    await fetchMarketSource(fetcher, 'https://fixture.invalid');
    await fetchMarketSource(fetcher, 'https://fixture.invalid');
    await expect(fetchMarketSource(fetcher, 'https://fixture.invalid')).rejects.toMatchObject({
      name: 'MarketSyncBudgetError',
    });
  });
  expect(requests).toBe(2);
  expect(budget.remaining).toBe(0);
  for (const stopped of [
    { remaining: 2, deadline: Date.now() - 1 },
    { remaining: 2, deadline: Date.now() + 30_000, signal: AbortSignal.abort() },
  ]) {
    await expect(
      withSourceRequestBudget(stopped, () => fetchMarketSource(fetcher, 'https://fixture.invalid')),
    ).rejects.toMatchObject({ name: 'MarketSyncBudgetError' });
  }
  expect(requests).toBe(2);
});
