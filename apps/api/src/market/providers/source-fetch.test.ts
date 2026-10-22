import { describe, expect, it } from 'vitest';
import { fetchMarketSource, readMarketSourceBytes, readMarketSourceText } from './source-fetch.js';
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
