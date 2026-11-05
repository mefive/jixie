import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { acceptCandidate, ingestCandidate, inspectCandidate } from './replica.js';
import { withCandidate } from './replica-files.js';

it(
  'resumes dated statements after a failed page, preserves PIT and publishes one version from both filters',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const initial = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource({ incomeAvailable: () => true }),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      const before = await inspectCandidate(initial.runId);
      await acceptCandidate(initial.runId, before.candidateVersion!);
      expect(await main.financialIncomeStatement.count()).toBe(1);
      const original = await main.financialIncomeStatement.findFirstOrThrow();

      const abort = new AbortController();
      const calls: Array<{ api: string; params: Record<string, unknown> }> = [];
      const fallback = ingestionSource({
        incomeAvailable: () => true,
        incomeAnnDate: '19910105',
        incomeActualAnnDate: '19910106',
      });
      const input = {
        targetDate: '19910106',
        clock: () => new Date('1991-01-07T10:00:00Z'),
        onLog: () => {},
        source: {
          call: async (api: string, params: Record<string, unknown> = {}, fields?: string) => {
            calls.push({ api, params });
            if (api === 'income_vip' && params.ann_date === '19910105' && !abort.signal.aborted) {
              if (params.offset === 5000) {
                abort.abort();
                throw new Error('Controlled statement page failure');
              }
              const rows = await fallback.call(api, params, fields);

              return [
                rows[0],
                ...Array.from({ length: 4999 }, () => ({ ...rows[0], comp_type: '2' })),
              ];
            }

            return fallback.call(api, params, fields);
          },
        },
      };
      const interrupted = await ingestCandidate({ ...input, signal: abort.signal }, true);
      expect(interrupted.phase).toBe('interrupted');
      expect(await main.financialIncomeStatement.count()).toBe(1);
      await withCandidate(interrupted.runId, async (candidate) => {
        expect(await candidate.financialIncomeStatement.count()).toBe(1);
      });

      calls.length = 0;
      const resumed = await ingestCandidate(input, true);
      expect(resumed).toMatchObject({ runId: interrupted.runId, phase: 'awaiting_publish' });
      expect(
        calls
          .filter(({ api }) => ['income_vip', 'balancesheet_vip', 'cashflow_vip'].includes(api))
          .every(({ params }) => !params.period && Boolean(params.ann_date || params.f_ann_date)),
      ).toBe(true);
      await withCandidate(interrupted.runId, async (candidate) => {
        const rows = await candidate.financialIncomeStatement.findMany();
        expect(rows).toHaveLength(2);
        expect(rows.find(({ fAnnDate }) => fAnnDate === '19910106')).toMatchObject({
          endDate: '19901231',
          annDate: '19910105',
          fAnnDate: '19910106',
          announcementDate: '19910106',
          availableDate: '19910107',
        });
        expect(rows.find(({ id }) => id === original.id)).toEqual(original);
      });
      expect(await main.financialIncomeStatement.count()).toBe(1);
      const reviewed = await inspectCandidate(interrupted.runId);
      await acceptCandidate(interrupted.runId, reviewed.candidateVersion!);
      expect(await main.financialIncomeStatement.count()).toBe(2);
    }),
  60_000,
);
