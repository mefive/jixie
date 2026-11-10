import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingestCandidate, inspectCandidate, acceptCandidate } from './replica.js';
import { withCandidate } from './replica-files.js';
import { measurePublication } from '../../tests/publication-measurements.js';

/**
 * 小规模常规验收；审阅后可用环境变量扩大至千万级，始终使用隔离库。
 *
 * Run small by default; opt into millions after review, always in an isolated database.
 */
it(
  'publishes a repeatable mix of updates, deletes and inserts at the requested scale',
  async () =>
    withSyncDatabase(async (main) => {
      const requested = Number(process.env.JIXIE_PUBLICATION_BENCHMARK_ROWS ?? 300);
      if (!Number.isSafeInteger(requested) || requested < 3 || requested > 30_000_000) {
        throw new Error('Expected 3 to 30000000 benchmark rows');
      }
      const count = Math.floor(requested / 3);
      const groups = ['update', 'delete', 'keep'];
      await emptySelections(main);
      for (const group of groups) {
        for (let start = 0; start < count; start += 1000) {
          await main.daily.createMany({
            data: Array.from({ length: Math.min(1000, count - start) }, (_, offset) => ({
              tsCode: `benchmark-${group}`,
              tradeDate: String(start + offset).padStart(8, '0'),
              close: 10,
            })),
          });
        }
      }
      const staged = await ingestCandidate(
        {
          targetDate: '19910104',
          source: ingestionSource(),
          clock: () => ingestionTime,
          onLog: () => {},
        },
        true,
      );
      await withCandidate(staged.runId, async (candidate) => {
        await candidate.daily.updateMany({
          where: { tsCode: 'benchmark-update' },
          data: { close: 20 },
        });
        await candidate.daily.deleteMany({ where: { tsCode: 'benchmark-delete' } });
        for (let start = 0; start < count; start += 1000) {
          await candidate.daily.createMany({
            data: Array.from({ length: Math.min(1000, count - start) }, (_, offset) => ({
              tsCode: 'benchmark-insert',
              tradeDate: String(start + offset).padStart(8, '0'),
              close: 30,
            })),
          });
        }
      });
      const review = await inspectCandidate(staged.runId);
      const started = performance.now();
      const result = await measurePublication({
        runId: staged.runId,
        rowsPerOperation: count,
        publish: () => acceptCandidate(staged.runId, review.candidateVersion!),
      });
      console.error(
        '[publication-benchmark]',
        JSON.stringify({ rowsPerOperation: count, elapsedMs: performance.now() - started, result }),
      );
      expect(result.mode).toBe('published');
      expect(await main.daily.count({ where: { tsCode: 'benchmark-update', close: 20 } })).toBe(
        count,
      );
      expect(await main.daily.count({ where: { tsCode: 'benchmark-delete' } })).toBe(0);
      expect(await main.daily.count({ where: { tsCode: 'benchmark-keep', close: 10 } })).toBe(
        count,
      );
      expect(await main.daily.count({ where: { tsCode: 'benchmark-insert', close: 30 } })).toBe(
        count,
      );
    }),
  process.env.JIXIE_PUBLICATION_BENCHMARK_ROWS ? 90 * 60_000 : 60_000,
);
