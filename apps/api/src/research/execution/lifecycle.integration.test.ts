import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('../../infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-research-lifecycle-');
  const databasePath = `${fixture.directory}/research.db`;
  writeFileSync(databasePath, '');
  return { prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});
const runtime = vi.hoisted(() => ({
  analyze: vi.fn(),
  execute: vi.fn(),
  reset: vi.fn(),
  interrupt: vi.fn(),
}));
vi.mock('./python-session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./python-session.js')>()),
  researchRuntimeManager: runtime,
}));

import { prisma } from '../../infra/database/prisma.js';
import {
  addResearchCell,
  deleteResearchCell,
  updateResearchCell,
} from '../documents/cell-operations.js';
import { getResearchDocument } from '../documents/read.js';
import { ResearchCellRevisionConflictError } from '../documents/revision-errors.js';
import { ResearchCellDependencyBlockedError } from '../dependencies/runnable.js';
import { getResearchExecution, promoteResearchExecution } from '../evidence/execution-records.js';
import {
  acceptResearchCellChangeReview,
  applyResearchCellChangeProposalForReview,
  prepareResearchCellChangeProposal,
  revertResearchCellChangeReview,
} from '../proposals/cell-changes.js';
import { persistResearchCellChangePart } from '../proposals/change-records.js';
import { runResearchCellChangeProposalAttempt } from '../proposals/attempts.js';
import { ResearchCellChangeReviewOpenError } from '../proposals/review-state.js';
import type { ResearchPythonAnalysis } from '../sdk/analysis-types.js';
import { interruptResearchDocument, resetResearchDocumentRuntime } from './control.js';
import { runResearchCell } from './run-cell.js';
import { runResearchDocument } from './run-document.js';
import { runAffectedResearchCells } from './run-affected.js';
import { isResearchDocumentRunActive, ResearchDocumentRunInProgressError } from './run-state.js';
import { ResearchPythonInterruptionError, type ResearchPythonExecution } from './python-session.js';

const ownerId = 'owner';
const documentId = 'document';
const sourceAnalysis: Record<string, Pick<ResearchPythonAnalysis, 'definitions' | 'references'>> = {
  'value = 1': { definitions: ['value'], references: [] },
  'value = 2': { definitions: ['value'], references: [] },
  'double = value * 2': { definitions: ['double'], references: ['value'] },
  'other = 3': { definitions: ['other'], references: [] },
};
function executionResult(source = 'value = 1'): ResearchPythonExecution {
  return {
    outputs: [{ type: 'text', text: source, level: 'info' }],
    ...sourceAnalysis[source],
    environmentFingerprint: 'fixture-python',
  };
}
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
async function saveProposal() {
  const proposal = await prepareResearchCellChangeProposal(ownerId, documentId, {
    title: 'Revise input',
    summary: 'Use the revised value',
    operations: [{ kind: 'update', cellId: 'input', expectedRevision: 1, source: 'value = 2' }],
  });
  await prisma.agentTurn.create({
    data: { id: 'turn', conversationId: documentId, status: 'done', model: 'fixture', trace: [] },
  });
  await prisma.agentMessage.create({
    data: {
      id: 'message',
      conversationId: documentId,
      turnId: 'turn',
      role: 'assistant',
      sequence: 1,
      parts: [{ type: 'research_cell_change', proposal }] as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.$transaction((transaction) =>
    persistResearchCellChangePart(transaction, {
      conversationId: documentId,
      messageId: 'message',
      turnId: 'turn',
      userId: ownerId,
      partIndex: 0,
      part: { type: 'research_cell_change', proposal },
    }),
  );
  return proposal.id;
}

describe('Research editing, execution evidence and proposal lifecycle', () => {
  beforeAll(() => {
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/research.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);

  beforeEach(async () => {
    Object.values(runtime).forEach((mock) => mock.mockReset());
    runtime.analyze.mockImplementation(
      async (_documentId: string, cells: Array<{ id: string; source: string }>) =>
        cells.map((cell) => {
          const analysis = sourceAnalysis[cell.source];
          if (!analysis) {
            throw new Error(`Missing Python analysis fixture: ${cell.source}`);
          }
          return { cellId: cell.id, ...analysis };
        }),
    );
    runtime.execute.mockImplementation(async (_documentId: string, cell: { source: string }) =>
      executionResult(cell.source),
    );
    runtime.reset.mockResolvedValue(undefined);
    await prisma.user.create({ data: { id: ownerId, email: 'owner@fixture.invalid' } });
    await prisma.agentConversation.create({
      data: { id: documentId, userId: ownerId, surface: 'research', title: 'Fixture research' },
    });
    await prisma.researchDocument.create({
      data: {
        id: documentId,
        userId: ownerId,
        conversationId: documentId,
        cells: {
          create: [
            {
              id: 'input',
              position: 0,
              kind: 'python',
              source: 'value = 1',
              ...sourceAnalysis['value = 1'],
            },
            {
              id: 'dependent',
              position: 1,
              kind: 'python',
              source: 'double = value * 2',
              ...sourceAnalysis['double = value * 2'],
            },
            {
              id: 'independent',
              position: 2,
              kind: 'python',
              source: 'other = 3',
              ...sourceAnalysis['other = 3'],
            },
          ],
        },
      },
    });
  });

  afterEach(async () => {
    try {
      expect(isResearchDocumentRunActive(documentId)).toBe(false);
    } finally {
      await prisma.user.deleteMany();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('keeps ownership checks across document, cell, run and evidence entry points', async () => {
    expect(await getResearchDocument('other', documentId)).toBeNull();
    expect(await addResearchCell('other', documentId, 'markdown')).toBeNull();
    expect(
      await updateResearchCell('other', 'input', { source: 'value = 2', expectedRevision: 1 }),
    ).toBeNull();
    expect(await deleteResearchCell('other', 'input')).toBeNull();
    expect(await runResearchCell('other', 'input')).toBeNull();
    expect(await runResearchDocument('other', documentId, true)).toBeNull();
    expect(await runAffectedResearchCells('other', 'input')).toBeNull();
    expect(await interruptResearchDocument('other', documentId)).toBeNull();
    expect(await resetResearchDocumentRuntime('other', documentId)).toBeNull();
    expect(runtime.execute).not.toHaveBeenCalled();
    const result = await runResearchDocument(ownerId, documentId, true);
    expect(await getResearchExecution('other', result!.execution!.id)).toBeNull();
  });

  it('invalidates only executed dependents and rejects an obsolete revision', async () => {
    await runResearchDocument(ownerId, documentId, false);
    const updated = await updateResearchCell(ownerId, 'input', {
      source: 'value = 2',
      expectedRevision: 1,
    });
    expect(updated?.cells.map((cell) => [cell.id, cell.status])).toEqual([
      ['input', 'stale'],
      ['dependent', 'stale'],
      ['independent', 'success'],
    ]);
    await expect(
      updateResearchCell(ownerId, 'input', { source: 'value = 1', expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(ResearchCellRevisionConflictError);
    const affected = await runAffectedResearchCells(ownerId, 'input');
    expect(affected?.executedCellIds).toEqual(['input', 'dependent']);
    expect(affected?.document.cells.every((cell) => cell.status === 'success')).toBe(true);
  });

  it('blocks a deleted upstream dependency while allowing an independent branch', async () => {
    await runResearchDocument(ownerId, documentId, false);
    const deleted = await deleteResearchCell(ownerId, 'input');
    expect(deleted?.cells.find((cell) => cell.id === 'dependent')).toMatchObject({
      status: 'blocked',
      dependencyIssues: [{ sourceCellId: 'input', missingDefinitions: ['value'] }],
    });
    await expect(runResearchCell(ownerId, 'dependent')).rejects.toBeInstanceOf(
      ResearchCellDependencyBlockedError,
    );
    const result = await runAffectedResearchCells(ownerId, 'independent');
    expect(result?.executedCellIds).toEqual(['independent']);
    await resetResearchDocumentRuntime(ownerId, documentId);
    expect(
      (await getResearchDocument(ownerId, documentId))?.cells.map((cell) => cell.status),
    ).toEqual(['blocked', 'stale']);
  });

  it('retains the frozen source when a cell is edited during a clean run', async () => {
    const started = deferred<void>();
    const release = deferred<ResearchPythonExecution>();
    runtime.execute.mockImplementationOnce(() => {
      started.resolve();
      return release.promise;
    });
    const running = runResearchDocument(ownerId, documentId, true);
    try {
      await started.promise;
      await updateResearchCell(ownerId, 'input', { source: 'value = 2', expectedRevision: 1 });
      release.resolve(executionResult());
      const result = await running;
      expect(result?.execution).toMatchObject({ status: 'success', contentRevision: 1 });
      const evidence = await getResearchExecution(ownerId, result!.execution!.id);
      expect(evidence?.cells[0]).toMatchObject({
        source: 'value = 1',
        revision: 1,
        status: 'success',
      });
      expect(result?.document.cells[0]).toMatchObject({
        source: 'value = 2',
        revision: 2,
        status: 'idle',
      });
      expect(runtime.reset).toHaveBeenCalledWith(documentId);
      expect(
        await promoteResearchExecution(ownerId, result!.execution!.id, {
          displayName: 'Frozen run',
          tags: [],
        }),
      ).toMatchObject({ displayName: 'Frozen run' });
    } finally {
      release.resolve(executionResult());
      await running.catch(() => {});
    }
  });

  it('shares the run lock and waits for cancellation persistence before releasing it', async () => {
    const started = deferred<void>();
    const release = deferred<ResearchPythonExecution>();
    runtime.execute.mockImplementationOnce(() => {
      started.resolve();
      return release.promise;
    });
    runtime.interrupt.mockImplementationOnce(() =>
      release.reject(new ResearchPythonInterruptionError('fixture-interrupted')),
    );
    const running = runResearchDocument(ownerId, documentId, true);
    try {
      await started.promise;
      expect(isResearchDocumentRunActive(documentId)).toBe(true);
      await expect(runResearchCell(ownerId, 'independent')).rejects.toBeInstanceOf(
        ResearchDocumentRunInProgressError,
      );
      const interrupted = await interruptResearchDocument(ownerId, documentId);
      const result = await running;
      expect(interrupted?.interrupted).toBe(true);
      expect(result?.execution?.status).toBe('cancelled');
      expect(isResearchDocumentRunActive(documentId)).toBe(false);
      expect(await prisma.researchCellExecution.findFirst()).toMatchObject({
        status: 'cancelled',
        sourceCellId: 'input',
      });
      expect((await runResearchCell(ownerId, 'input'))?.cells[0].status).toBe('success');
    } finally {
      release.resolve(executionResult());
      await running.catch(() => {});
    }
  });

  it('records a failed branch and skips its dependents releases the run lock', async () => {
    runtime.execute.mockRejectedValueOnce(new Error('fixture computation failed'));
    const result = await runAffectedResearchCells(ownerId, 'input');
    expect(result?.executedCellIds).toEqual(['input']);
    expect(result?.document.cells.map((cell) => cell.status)).toEqual(['error', 'idle', 'idle']);
    expect(await prisma.researchCellExecution.findFirst()).toMatchObject({
      status: 'error',
      error: 'fixture computation failed',
    });
    expect((await runResearchCell(ownerId, 'independent'))?.cells[2].status).toBe('success');
  });

  it('requires review acceptance before an applied proposal can run and links attempt evidence', async () => {
    const proposalId = await saveProposal();
    const applied = await applyResearchCellChangeProposalForReview(ownerId, proposalId);
    expect(applied?.outcome).toBe('applied');
    expect(runtime.execute).not.toHaveBeenCalled();
    await expect(runResearchCell(ownerId, 'input')).rejects.toBeInstanceOf(
      ResearchCellChangeReviewOpenError,
    );
    await expect(addResearchCell(ownerId, documentId, 'markdown')).rejects.toBeInstanceOf(
      ResearchCellChangeReviewOpenError,
    );
    await expect(resetResearchDocumentRuntime(ownerId, documentId)).rejects.toBeInstanceOf(
      ResearchCellChangeReviewOpenError,
    );
    expect(await runResearchCellChangeProposalAttempt('other', proposalId)).toBeNull();
    await acceptResearchCellChangeReview(ownerId, proposalId, applied!.document.contentRevision);
    const result = await runResearchCellChangeProposalAttempt(ownerId, proposalId);
    expect(result?.attempt).toMatchObject({
      status: 'success',
      plannedCellIds: ['input', 'dependent'],
    });
    expect(
      await prisma.researchCellExecution.count({
        where: { cellChangeAttemptId: result!.attempt.id },
      }),
    ).toBe(2);
    expect(await prisma.researchExecution.count()).toBe(0);
    expect(
      (await prisma.agentMessage.findUniqueOrThrow({ where: { id: 'message' } })).parts,
    ).toMatchObject([{ proposal: { reviewStatus: 'accepted' } }]);
  });

  it('reverts a review without executing cells or discarding the proposal history', async () => {
    const proposalId = await saveProposal();
    const applied = await applyResearchCellChangeProposalForReview(ownerId, proposalId);
    const result = await revertResearchCellChangeReview(
      ownerId,
      proposalId,
      applied!.document.contentRevision,
    );
    expect(result?.outcome).toBe('reverted');
    expect(result?.document.cells[0].source).toBe('value = 1');
    expect(
      await prisma.researchCellChangeProposal.findUnique({ where: { id: proposalId } }),
    ).toMatchObject({ reviewStatus: 'reverted' });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('stops an accepted attempt if the document changes between cell executions', async () => {
    const proposalId = await saveProposal();
    const applied = await applyResearchCellChangeProposalForReview(ownerId, proposalId);
    await acceptResearchCellChangeReview(ownerId, proposalId, applied!.document.contentRevision);
    const started = deferred<void>();
    const release = deferred<ResearchPythonExecution>();
    runtime.execute.mockImplementationOnce(() => {
      started.resolve();
      return release.promise;
    });
    const running = runResearchCellChangeProposalAttempt(ownerId, proposalId);
    try {
      await started.promise;
      await updateResearchCell(ownerId, 'input', { source: 'value = 1', expectedRevision: 2 });
      release.resolve(executionResult('value = 2'));
      const result = await running;
      expect(result?.attempt).toMatchObject({
        status: 'error',
        error: 'document_changed_during_run',
      });
      expect(runtime.execute).toHaveBeenCalledTimes(1);
      expect(
        await prisma.researchCellExecution.count({
          where: { cellChangeAttemptId: result!.attempt.id },
        }),
      ).toBe(1);
    } finally {
      release.resolve(executionResult('value = 2'));
      await running.catch(() => {});
    }
  });
});
