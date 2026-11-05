import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { resetBusinessData } from './reset.js';

it(
  'backs up before deleting all business data and preserves complete authentication rows',
  async () =>
    withSyncDatabase(async (database) => {
      await database.user.create({
        data: { id: 'user', email: 'fixture@example.test', name: 'Keep', status: 'active' },
      });
      await database.session.create({
        data: { id: 'session', userId: 'user', expiresAt: new Date('2030-01-01') },
      });
      await database.inviteCode.create({
        data: {
          code: 'invite',
          status: 'used',
          usedByEmail: 'fixture@example.test',
          usedAt: new Date('2026-10-01'),
          note: 'Keep',
        },
      });
      await database.emailLoginChallenge.create({
        data: {
          id: 'challenge',
          email: 'fixture@example.test',
          inviteCode: 'invite',
          codeHash: 'opaque-hash',
          expiresAt: new Date('2030-01-01'),
          attempts: 2,
        },
      });
      await database.factorReport.create({
        data: {
          id: 'report',
          userId: 'user',
          factor: 'private',
          freq: 'month',
          start: '20200101',
          end: '20201001',
        },
      });
      await database.factor.create({
        data: {
          id: 'factor',
          userId: 'user',
          key: 'private',
          name: 'Private factor',
          code: 'private code',
          approvedReportId: 'report',
        },
      });
      await database.strategy.create({
        data: { id: 'strategy', userId: 'user', name: 'Private strategy', config: {} },
      });
      await database.agentConversation.create({
        data: { id: 'conversation', userId: 'user', surface: 'research' },
      });
      await database.researchDocument.create({
        data: { id: 'document', userId: 'user', conversationId: 'conversation' },
      });
      await database.researchEmbeddedAnalysis.create({
        data: {
          id: 'embedded',
          userId: 'user',
          hostType: 'factor',
          hostId: 'factor',
          title: 'Private analysis',
        },
      });
      await database.researchEmbeddedAnalysisVersion.create({
        data: {
          id: 'version',
          analysisId: 'embedded',
          number: 1,
          documentId: 'document',
          source: 'private source',
          parameters: {},
          inputScope: 'all',
        },
      });
      await database.researchExecution.create({
        data: {
          id: 'execution',
          documentId: 'document',
          sequence: 1,
          contentRevision: 1,
          embeddedVersionId: 'version',
        },
      });
      await database.daily.create({
        data: { tsCode: '600000.SH', tradeDate: '20261030', close: 10 },
      });
      await database.ingestionRun.create({
        data: {
          id: 'run',
          targetDate: '20261030',
          trigger: 'manual',
          status: 'completed',
          scopeSnapshot: {},
        },
      });
      await database.ingestionBatch.create({
        data: {
          id: 'batch',
          runId: 'run',
          dataset: 'stock-prices',
          scope: 'all',
          period: '20261030',
          api: 'daily',
          request: {},
          status: 'succeeded',
        },
      });
      await database.ingestionIssue.create({
        data: {
          id: 'issue',
          runId: 'run',
          batchId: 'batch',
          category: 'record',
          reasonCode: 'fixture',
          message: 'Fixture',
        },
      });
      await database.ingestionReplicaChange.create({
        data: { model: 'daily', key: '["600000.SH","20181231"]' },
      });
      const auth = () =>
        Promise.all([
          database.user.findMany(),
          database.session.findMany(),
          database.inviteCode.findMany(),
          database.emailLoginChallenge.findMany(),
        ]);
      const before = await auth();
      expect(await resetBusinessData({ apply: false })).toMatchObject({ mode: 'preview' });
      expect(await database.factor.count()).toBe(1);
      await expect(
        resetBusinessData({
          apply: true,
          backup: async () => {
            throw new Error('controlled backup failure');
          },
        }),
      ).rejects.toThrow('controlled backup failure');
      expect(await database.factor.count()).toBe(1);
      const backup = vi.fn(async () => '/isolated/backup.db');
      expect(await resetBusinessData({ apply: true, backup })).toMatchObject({
        mode: 'applied',
        backup: '/isolated/backup.db',
      });
      expect(backup).toHaveBeenCalledOnce();
      expect(await auth()).toEqual(before);
      const counts = await Promise.all([
        database.factor.count(),
        database.strategy.count(),
        database.factorReport.count(),
        database.agentConversation.count(),
        database.researchDocument.count(),
        database.researchEmbeddedAnalysis.count(),
        database.researchExecution.count(),
        database.daily.count(),
        database.ingestionRun.count(),
        database.ingestionBatch.count(),
        database.ingestionIssue.count(),
        database.ingestionReplicaChange.count(),
      ]);
      expect(counts).toEqual(counts.map(() => 0));
    }),
  60_000,
);

it('accounts for every non-auth model, including receipt tables cleared through cascades', async () => {
  const schema = await readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
  const source = await readFile(new URL('./reset.ts', import.meta.url), 'utf8');
  const models = [...schema.matchAll(/^model (\w+)/gm)].map(
    (match) => match[1][0].toLowerCase() + match[1].slice(1),
  );
  const cleared = new Set(
    [...source.matchAll(/(?:database|transaction)\.(\w+)\.deleteMany/g)].map((match) => match[1]),
  );
  expect(models.filter((model) => !cleared.has(model)).sort()).toEqual([
    'emailLoginChallenge',
    'ingestionBatch',
    'ingestionIssue',
    'ingestionIssueResolution',
    'inviteCode',
    'session',
    'user',
  ]);
});
