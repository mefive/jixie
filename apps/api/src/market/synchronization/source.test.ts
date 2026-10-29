import { describe, expect, it } from 'vitest';
import { fetchSourcePages, completeResponse } from './source.js';
import { localDate, isObservationDate } from './date.js';
import { MarketSyncBudgetError } from '../errors.js';
import { fetchMarketSource, withSourceRequestBudget } from '../providers/source-fetch.js';

describe('bounded source evidence', () => {
  it('A05 preserves received pages after a later transport failure', async () => {
    let calls = 0;
    const pages = await fetchSourcePages(
      {
        call: async () => {
          if (calls++ === 0) {
            return [{ ts_code: '600000.SH' }, { ts_code: '000001.SZ' }];
          }
          throw new Error('provider unavailable');
        },
      },
      'daily',
      {},
      'ts_code',
      2,
    );
    expect(pages.rows).toHaveLength(2);
    expect(pages.complete).toBe(false);
    expect(pages.errors).toEqual(['provider unavailable']);
  });

  it('A05 never accepts repeated full pages as completion', async () => {
    const pages = await fetchSourcePages(
      { call: async () => [{ ts_code: '600000.SH' }] },
      'daily',
      {},
      'ts_code',
      1,
      3,
    );
    expect(pages.complete).toBe(false);
    expect(pages.rows).toHaveLength(1);
    expect(pages.errors[0]).toContain('repeated');
  });

  it('A05/A06 distinguishes authoritative sparse empty responses from unexplained dense emptiness', () => {
    const pages = { rows: [], complete: true, pages: 1, errors: [] };
    expect(
      completeResponse({ pages, table: 'Daily', records: [], coverageComplete: false }).status,
    ).toBe('error');
    const empty = completeResponse({
      pages,
      table: 'Dividend',
      coverageComplete: true,
      replace: true,
      records: [],
      allowEmpty: true,
    });
    expect(empty.status).toBe('complete');
    expect(empty.tables[0].replace).toBe(true);
  });

  it('A07 bounds actual HTTP attempts across providers and retries', async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests++;
      return new Response('fixture');
    };
    await withSourceRequestBudget({ remaining: 2, deadline: Date.now() + 1000 }, async () => {
      await fetchMarketSource(fetcher, 'https://fixture.invalid/one');
      await fetchMarketSource(fetcher, 'https://fixture.invalid/two');
      await expect(
        fetchMarketSource(fetcher, 'https://fixture.invalid/three'),
      ).rejects.toBeInstanceOf(MarketSyncBudgetError);
    });
    expect(requests).toBe(2);
  });

  it('A01/A09 freezes distinct local calendar dates without normalizing invalid input', () => {
    const at = new Date('2026-09-15T16:30:00Z');
    expect(localDate(at)).toBe('20260916');
    expect(localDate(at, 'America/New_York')).toBe('20260915');
    expect(isObservationDate('20260230')).toBe(false);
    expect(isObservationDate('20260228')).toBe(true);
  });
});
