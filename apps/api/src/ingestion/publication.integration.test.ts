import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingestCandidate, acceptCandidate, inspectCandidate, recoverCandidate } from './replica.js';
import { withCandidate, candidateFilename } from './replica-files.js';
import { PublicationPlan } from './publication-plan.js';
import { prepareMarketPublication, applyMarketPublicationChunk } from './replica-changes.js';
import {
  acquireMarketScope,
  isMarketPublicationActive,
  acquireMarketLock,
} from '#infra/coordination/market-access.js';

const input = {
  targetDate: '19910104',
  source: ingestionSource(),
  clock: () => ingestionTime,
  onLog: () => {},
};

it(
  'prepares without publishing, preserves scalar types and applies final insert/update/delete semantics',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      for (const tradeDate of ['19800101', '19800102', '19800103']) {
        await main.daily.create({ data: { tsCode: 'fixture', tradeDate, close: 10 } });
      }
      const staged = await ingestCandidate(input, true);
      const plan = await PublicationPlan.create({
        runId: staged.runId,
        operation: randomUUID(),
        candidateVersion: 'test',
        baseline: 'test',
      });
      try {
        await withCandidate(staged.runId, async (candidate) => {
          await candidate.daily.update({
            where: { tsCode_tradeDate: { tsCode: 'fixture', tradeDate: '19800101' } },
            data: { close: 12 },
          });
          await candidate.daily.delete({
            where: { tsCode_tradeDate: { tsCode: 'fixture', tradeDate: '19800102' } },
          });
          await candidate.daily.update({
            where: { tsCode_tradeDate: { tsCode: 'fixture', tradeDate: '19800103' } },
            data: { close: 11 },
          });
          await candidate.daily.update({
            where: { tsCode_tradeDate: { tsCode: 'fixture', tradeDate: '19800103' } },
            data: { close: 10 },
          });
          await candidate.daily.create({
            data: { tsCode: 'fixture', tradeDate: '19800104', close: 15 },
          });
          await candidate.daily.create({
            data: { tsCode: 'fixture', tradeDate: '19800105', close: 15 },
          });
          await candidate.daily.delete({
            where: { tsCode_tradeDate: { tsCode: 'fixture', tradeDate: '19800105' } },
          });
          await prepareMarketPublication(candidate, main, plan);
        });
        await plan.seal();
        await plan.validate();
        expect(await main.daily.findMany({ where: { tsCode: 'fixture' } })).toHaveLength(3);
        expect(await main.daily.findFirst({ where: { tsCode: 'fixture' } })).toMatchObject({
          close: 10,
        });
        await main.$transaction(async (transaction) => {
          for await (const chunk of plan.read()) {
            await applyMarketPublicationChunk(transaction, chunk);
          }
        });
        const rows = await main.daily.findMany({
          where: { tsCode: 'fixture' },
          orderBy: { tradeDate: 'asc' },
        });
        expect(rows.map((row) => [row.tradeDate, row.close])).toEqual([
          ['19800101', 12],
          ['19800103', 10],
          ['19800104', 15],
        ]);
      } finally {
        await plan.dispose();
      }
    }),
  60_000,
);

it(
  'keeps readers available during preparation and replays diagnostics only after preparation',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      const review = await inspectCandidate(staged.runId);
      const original = PublicationPlan.prototype.validate;
      const validation = vi
        .spyOn(PublicationPlan.prototype, 'validate')
        .mockImplementation(async function (this: PublicationPlan, signal?: AbortSignal) {
          expect(await isMarketPublicationActive()).toBe(false);
          const reader = await acquireMarketScope();
          await reader.release();
          expect(await main.daily.count()).toBe(0);
          await expect(acquireMarketLock('maintenance')).rejects.toMatchObject({
            reason: 'market_publication_busy',
          });
          await original.call(this, signal);
        });
      try {
        await expect(
          acceptCandidate(staged.runId, review.candidateVersion!),
        ).resolves.toMatchObject({ mode: 'published' });
        expect(validation).toHaveBeenCalledOnce();
        expect(await main.ingestionBatch.count()).toBeGreaterThan(0);
        expect(
          (await readdir(dirname(candidateFilename(staged.runId)))).filter((name) =>
            name.endsWith('.plan'),
          ),
        ).toEqual([]);
      } finally {
        validation.mockRestore();
      }
    }),
  60_000,
);

it(
  'rejects a damaged sealed plan and preserves Date, null, bigint and bytes',
  async () =>
    withSyncDatabase(async () => {
      const staged = await ingestCandidate(input, true);
      const plan = await PublicationPlan.create({
        runId: staged.runId,
        operation: randomUUID(),
        candidateVersion: 'test',
        baseline: 'test',
      });
      try {
        const value = {
          date: new Date('2020-01-01'),
          empty: null,
          amount: 1.25,
          large: 9007199254740993n,
          bytes: new Uint8Array([1, 2]),
          text: 'null',
        };
        await plan.append(value);
        await plan.seal();
        const rows = [];
        for await (const row of plan.read()) {
          rows.push(row);
        }
        expect(rows).toEqual([value]);
        const bytes = await readFile(plan.filename);
        bytes[bytes.length - 1] ^= 1;
        await writeFile(plan.filename, bytes);
        await expect(plan.validate()).rejects.toThrow('checksum');
      } finally {
        await plan.dispose();
      }
    }),
  60_000,
);

it(
  'rolls back writes when the prepared file changes after initial validation',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      const review = await inspectCandidate(staged.runId);
      const original = PublicationPlan.prototype.validate;
      const validation = vi
        .spyOn(PublicationPlan.prototype, 'validate')
        .mockImplementation(async function (this: PublicationPlan, signal?: AbortSignal) {
          await original.call(this, signal);
          await appendFile(this.filename, 'damaged');
        });
      try {
        await expect(acceptCandidate(staged.runId, review.candidateVersion!)).rejects.toThrow(
          'length changed',
        );
        expect(await main.daily.count()).toBe(0);
        expect(await main.marketDataState.count()).toBe(0);
        expect(await inspectCandidate(staged.runId)).toMatchObject({
          phase: 'awaiting_publish',
          candidateVersion: review.candidateVersion,
        });
      } finally {
        validation.mockRestore();
      }
    }),
  60_000,
);

it(
  'manual recovery cleans only the stopped operation plan and preserves the candidate',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      const operation = randomUUID();
      const plan = await PublicationPlan.create({
        runId: staged.runId,
        operation,
        candidateVersion: 'test',
        baseline: 'test',
      });
      await plan.append({ incomplete: true });
      await plan.seal();
      await main.ingestionRun.update({
        where: { id: staged.runId },
        data: { replicaPhase: 'publishing', replicaOperation: operation },
      });
      await expect(recoverCandidate(staged.runId)).resolves.toMatchObject({
        phase: 'awaiting_publish',
      });
      await expect(readFile(plan.filename)).rejects.toMatchObject({ code: 'ENOENT' });
      await withCandidate(staged.runId, async (candidate) =>
        expect(await candidate.daily.count()).toBeGreaterThan(0),
      );
    }),
  60_000,
);

it(
  'cancels after preparation without publishing and removes the temporary plan',
  async () =>
    withSyncDatabase(async (main) => {
      await emptySelections(main);
      const staged = await ingestCandidate(input, true);
      const review = await inspectCandidate(staged.runId);
      const controller = new AbortController();
      const original = PublicationPlan.prototype.validate;
      const validation = vi
        .spyOn(PublicationPlan.prototype, 'validate')
        .mockImplementation(async function (this: PublicationPlan, signal?: AbortSignal) {
          await original.call(this, signal);
          controller.abort();
        });
      try {
        await expect(
          acceptCandidate(staged.runId, review.candidateVersion!, controller.signal),
        ).rejects.toThrow();
        expect(await main.daily.count()).toBe(0);
        expect(await inspectCandidate(staged.runId)).toMatchObject({ phase: 'awaiting_publish' });
        expect(
          (await readdir(dirname(candidateFilename(staged.runId)))).filter((name) =>
            name.endsWith('.plan'),
          ),
        ).toEqual([]);
      } finally {
        validation.mockRestore();
      }
    }),
  60_000,
);
