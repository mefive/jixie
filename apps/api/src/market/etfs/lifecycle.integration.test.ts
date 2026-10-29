import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { DATASET_POLICIES } from '../synchronization/policies.js';
import { datasetScopes } from '../synchronization/scopes.js';
import { listDownloads } from '../downloads/lists.js';
import { selectSyncWindow } from '#maintenance/partitions.js';
import { readHistoryGaps } from '#maintenance/status.js';
import { prepareEtfPartition } from './sync-partition.js';
import { etfDownloadRange } from './download-range.js';

describe('ETF listing lifecycle maintenance', () => {
  it.each([null, '20260230', '20260831'])(
    'refuses to guess a delisting boundary for %s',
    (delistDate) => {
      expect(
        etfDownloadRange({ listStatus: 'D', listDate: '20260901', delistDate }, '20150101'),
      ).toMatchObject({ blockedReason: expect.any(String) });
    },
  );

  it.each(['etf-prices', 'etf-adjustments'])(
    'caps %s at delisting and skips only blocked objects while preserving the saved list',
    async (dataset) =>
      withSyncDatabase(async (database) => {
        const codes = ['510000.SH', '510001.SH', '510002.SH', '510003.SH'];
        await database.marketDownloadList.create({ data: { assetType: 'etf', codes } });
        await database.etfBasic.createMany({
          data: codes.map((tsCode, index) => ({
            tsCode,
            name: tsCode,
            listDate: '20260901',
            listStatus: ['L', 'D', 'D', 'P'][index],
            exchange: 'SH',
            sameDayTurnover: false,
            delistDate: index === 1 ? '20260911' : null,
          })),
        });
        await database.etfDaily.create({
          data: { tsCode: codes[1], tradeDate: '20260911', close: 1 },
        });
        await database.datasetSyncPartition.create({
          data: {
            id: 'old-window-beyond-delisting',
            dataset,
            scope: codes[1],
            startDate: '20260901',
            endDate: '20260915',
            policyVersion: 'sync-v1',
            status: 'error',
          },
        });
        const policy = DATASET_POLICIES.find((entry) => entry.dataset === dataset)!;
        const objects = await datasetScopes(policy);
        expect(objects.find((row) => row.scope === codes[1])).toMatchObject({
          endDate: '20260911',
        });
        expect(objects.find((row) => row.scope === codes[2])?.blockedReason).toContain(
          'delisting date',
        );

        for (const history of [false, true]) {
          const attempted = new Set<string>();
          const selected = [];
          for (let index = 0; index < 4; index++) {
            const next = await selectSyncWindow({
              policy,
              targetDate: '20260915',
              startedAt: new Date('2026-10-29T10:00:00Z'),
              history,
              attempted,
              deadline: Date.now() + 30_000,
            });
            if (!next) {
              break;
            }
            selected.push(next);
            attempted.add(next.id);
          }
          expect(selected.map((row) => row.scope)).toEqual([codes[0], codes[1]]);
          expect(selected.map((row) => row.endDate)).toEqual(['20260915', '20260911']);

          const calls: Record<string, unknown>[] = [];
          await prepareEtfPartition(
            {
              async call(_api, params) {
                calls.push(params!);
                return [];
              },
            },
            selected[1],
          );
          expect(calls[0]).toMatchObject({ ts_code: codes[1], end_date: '20260911' });
        }

        const gaps = await readHistoryGaps('20260915', new Date('2026-10-29T10:00:00Z'));
        expect(gaps).toContain(`${dataset}/${codes[2]}: Delisted ETF has no valid delisting date`);
        const listed = await listDownloads('etf');
        expect(listed.rows.map((row) => row.tsCode)).toEqual(codes);
        expect(listed.rows[1]).toMatchObject({
          lifecycle: { listStatus: 'D', delistDate: '20260911' },
          download: { endDate: '20260911' },
        });
        expect(listed.rows[2]).toMatchObject({
          download: { blockedReason: expect.stringContaining('delisting date') },
        });
        expect(await database.etfDaily.count()).toBe(1);
      }),
  );
});
