import { expect, it } from 'vitest';
import { acquireMarketScope } from '#infra/coordination/market-access.js';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import {
  acceptCandidate,
  ingestCandidate,
  inspectCandidate,
  rejectCandidate,
  repairCandidate,
  recoverCandidate,
  retryCandidate,
} from './replica.js';
import { withCandidate } from './replica-files.js';
import { exportIngestionIssues } from './issue-export.js';
import { issueRepairPlanSchema } from './repair-schema.js';
import { repairIngestionIssues } from './repair.js';
import { candidateFilename } from './replica-files.js';

const targetDate = '19910104';
const input = {
  targetDate,
  source: ingestionSource(),
  clock: () => ingestionTime,
  onLog: () => {},
};

it(
  'explicitly retries only failed candidate batches and keeps the original diagnostics as history',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      await main.ingestionSelection.update({
        where: { assetType: 'index' },
        data: { codes: ['000300.SH'] },
      });
      let fail = true;
      const calls: Array<{ api: string; params: Record<string, unknown> }> = [];
      const fallback = ingestionSource();
      const source = {
        call: async (api: string, params: Record<string, unknown> = {}, fields?: string) => {
          calls.push({ api, params });
          if (api === 'index_weight' && params.trade_date === targetDate && fail) {
            throw new Error('Controlled index-weight rejection');
          }

          return fallback.call(api, params, fields);
        },
      };
      const first = await ingestCandidate({ ...input, source }, true);
      expect(first.phase).toBe('awaiting_repair');
      expect(await main.daily.count()).toBe(0);
      const before = await withCandidate(first.runId, (candidate) =>
        candidate.ingestionBatch.findMany({ where: { runId: first.runId, status: 'succeeded' } }),
      );
      expect(before.length).toBeGreaterThan(0);
      fail = false;
      calls.length = 0;
      const retried = await retryCandidate(first.runId, {
        source,
        clock: input.clock,
        onLog: input.onLog,
      });

      expect(retried).toMatchObject({ runId: first.runId, phase: 'awaiting_publish', pending: 0 });
      expect(calls).toEqual([
        {
          api: 'index_weight',
          params: { index_code: '000300.SH', trade_date: targetDate, limit: 1000, offset: 0 },
        },
      ]);
      await withCandidate(first.runId, async (candidate) => {
        expect(await candidate.ingestionIssue.count({ where: { runId: first.runId } })).toBe(1);
        expect(
          await candidate.ingestionBatch.count({
            where: { id: { in: before.map(({ id }) => id) }, status: 'succeeded' },
          }),
        ).toBe(before.length);
        const bundle = await exportIngestionIssues({
          runId: first.runId,
          dataLocation: 'candidate',
          code: { commit: 'fixture', sourceDirty: false },
        });
        expect(bundle.counts).toMatchObject({
          currentDiagnostics: { error: 0 },
          historicalDiagnostics: { error: 1 },
        });
      });
      await expect(retryCandidate(first.runId, { source })).rejects.toMatchObject({
        reason: 'candidate_state_conflict',
      });
    }),
  60_000,
);

it(
  'stages data, requires the reviewed version, atomically publishes and preserves concurrent user writes',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      expect(staged.phase).toBe('awaiting_publish');
      expect(await main.daily.count()).toBe(0);
      expect(await main.ingestionBatch.count()).toBe(0);
      expect(await ingestCandidate(input, true)).toMatchObject({
        mode: 'existing_candidate',
        runId: staged.runId,
      });
      const runId = staged.runId;
      await main.user.create({ data: { id: 'online-user', email: 'online@example.test' } });
      const inspect = await inspectCandidate(runId);
      expect(inspect.candidateVersion).toBeDefined();
      await expect(acceptCandidate(runId, 'a'.repeat(64))).rejects.toMatchObject({
        reason: 'candidate_state_conflict',
      });
      expect(await main.daily.count()).toBe(0);

      await expect(acceptCandidate(runId, inspect.candidateVersion!)).resolves.toMatchObject({
        mode: 'published',
        revision: 1,
      });
      expect(await main.daily.count()).toBeGreaterThan(0);
      expect(await main.ingestionBatch.count({ where: { runId } })).toBeGreaterThan(0);
      expect(await main.user.count({ where: { id: 'online-user' } })).toBe(1);
      expect(await main.ingestionRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
        activeReplica: null,
        replicaPhase: 'published',
        publishedRevision: 1,
      });
      await expect(acceptCandidate(runId, inspect.candidateVersion!)).resolves.toMatchObject({
        mode: 'already_published',
        revision: 1,
      });
    }),
  60_000,
);

it(
  'repairs the candidate and carries the repaired value and issue result into the same publication',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(
        {
          ...input,
          source: ingestionSource({
            prices: (date) => [
              {
                ts_code: '600000.SH',
                trade_date: date,
                open: 10,
                high: 12,
                low: date === targetDate ? 11 : 9,
                close: 11,
              },
            ],
          }),
        },
        true,
      );
      expect(staged.phase).toBe('awaiting_repair');
      const runId = staged.runId;
      const bundle = await withCandidate(runId, () =>
        exportIngestionIssues({
          runId,
          dataLocation: 'candidate',
          code: { commit: 'fixture', sourceDirty: false },
        }),
      );
      const issue = bundle.items.find((item) => item.issue.severity === 'warning')!;
      const templates = issue.context.templates as Array<{ op: string }>;
      const plan = issueRepairPlanSchema.parse({
        runId,
        actions: [
          {
            ...templates.find(({ op }) => op === 'update'),
            values: { low: 9 },
            reason: 'Fixture vendor quotes',
            evidence: ['https://example.test/fixture'],
          },
        ],
      });
      const options = { candidatePath: candidateFilename(runId) };
      const preview = await repairCandidate(runId, false, () =>
        repairIngestionIssues(plan, options),
      );
      await repairCandidate(runId, true, () =>
        repairIngestionIssues(plan, { ...options, expectedHash: preview.planHash }),
      );
      expect(await main.daily.count()).toBe(0);
      expect(await main.ingestionIssueResolution.count()).toBe(0);
      const reviewed = await inspectCandidate(runId);
      expect(reviewed.phase).toBe('awaiting_publish');
      await acceptCandidate(runId, reviewed.candidateVersion!);
      expect(
        await main.daily.findUnique({
          where: { tsCode_tradeDate: { tsCode: '600000.SH', tradeDate: targetDate } },
        }),
      ).toMatchObject({ low: 9 });
      expect(
        await main.ingestionIssueResolution.findUnique({
          where: { issueId: String(issue.issue.id) },
        }),
      ).toMatchObject({ status: 'resolved', marketRevision: 1 });
    }),
  60_000,
);

it(
  'retains a rejected candidate as run history and refuses to publish against a changed baseline',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      const reviewed = await inspectCandidate(staged.runId);
      await main.ingestionSelection.update({
        where: { assetType: 'index' },
        data: { codes: ['000300.SH'] },
      });
      await expect(acceptCandidate(staged.runId, reviewed.candidateVersion!)).rejects.toMatchObject(
        {
          reason: 'candidate_baseline_changed',
        },
      );
      expect(await main.daily.count()).toBe(0);
      expect(await rejectCandidate(staged.runId, 'Changed baseline')).toMatchObject({
        mode: 'rejected',
      });
      expect(
        await main.ingestionRun.findUniqueOrThrow({ where: { id: staged.runId } }),
      ).toMatchObject({
        activeReplica: null,
        replicaPhase: 'rejected',
        rejectionReason: 'Changed baseline',
      });
    }),
  60_000,
);

it(
  'recovers an interrupted publication claim from the candidate and leaves data unpublished',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      await main.ingestionRun.update({
        where: { id: staged.runId },
        data: { replicaPhase: 'publishing', replicaOperation: 'stopped-process' },
      });
      await expect(recoverCandidate(staged.runId)).resolves.toMatchObject({
        phase: 'awaiting_publish',
      });
      expect(await main.daily.count()).toBe(0);
      await withCandidate(staged.runId, async (candidate) => {
        expect(await candidate.daily.count()).toBeGreaterThan(0);
      });
    }),
  60_000,
);

it(
  'rolls back market writes and diagnostics when the publication transaction fails',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      await main.$executeRawUnsafe(`CREATE TRIGGER refuse_candidate_publication
      BEFORE INSERT ON "IngestionBatch"
      WHEN EXISTS (SELECT 1 FROM "User" WHERE id = 'publication-failure')
      BEGIN SELECT RAISE(ABORT, 'controlled publication failure'); END`);
      const staged = await ingestCandidate(input, true);
      const reviewed = await inspectCandidate(staged.runId);
      await main.user.create({
        data: { id: 'publication-failure', email: 'failure@example.test' },
      });
      await expect(acceptCandidate(staged.runId, reviewed.candidateVersion!)).rejects.toThrow();
      expect(await main.daily.count()).toBe(0);
      expect(await main.ingestionBatch.count()).toBe(0);
      expect(await main.marketDataState.count()).toBe(0);
      expect(await inspectCandidate(staged.runId)).toMatchObject({
        phase: 'awaiting_publish',
        candidateVersion: reviewed.candidateVersion,
      });

      await main.user.delete({ where: { id: 'publication-failure' } });
      await expect(
        acceptCandidate(staged.runId, reviewed.candidateVersion!),
      ).resolves.toMatchObject({
        mode: 'published',
        revision: 1,
      });
    }),
  60_000,
);

it(
  'retains an awaiting candidate if existing market readers do not drain',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      const reviewed = await inspectCandidate(staged.runId);
      const reader = await acquireMarketScope();
      const previous = process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS;
      process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS = '50';
      try {
        await expect(
          acceptCandidate(staged.runId, reviewed.candidateVersion!),
        ).rejects.toMatchObject({ reason: 'market_publication_busy' });
        expect(await main.daily.count()).toBe(0);
        expect(await inspectCandidate(staged.runId)).toMatchObject({
          phase: 'awaiting_publish',
          candidateVersion: reviewed.candidateVersion,
        });
      } finally {
        await reader.release();
        if (previous === undefined) {
          delete process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS;
        } else {
          process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS = previous;
        }
      }
    }),
  60_000,
);
