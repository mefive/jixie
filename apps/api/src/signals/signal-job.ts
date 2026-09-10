import { fork } from 'node:child_process';
import { z } from 'zod';
import type { FactorInputSummary, LogLine, ModelPositionSnapshot, SignalItem } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { defineJob } from '#infra/jobs/definition.js';
import { runJobWorker } from '#infra/jobs/worker-result.js';
import { t } from '#i18n/messages.js';
import { notifySignalRun } from './notifier.js';
import { initializeSignalAccounting } from './accounting/initialize.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./runs/signal-worker.boot.mjs', import.meta.url)
  : new URL('./runs/signal-worker.js', import.meta.url);
const signalJobPayloadSchema = z.object({
  task: z.literal('signal'),
  runId: z.string().min(1),
  locale: z.enum(['zh', 'en']),
});

export const signalJob = defineJob({
  parse(raw, job) {
    const input = signalJobPayloadSchema.parse(raw);
    if (input.runId !== job.signalRunId) {
      throw new Error('Signal payload does not match its persisted run');
    }
    return input;
  },
  async execute(context, input): Promise<SignalWorkerOutput> {
    return runJobWorker<SignalWorkerOutput>({
      context,
      start: () =>
        fork(workerUrl, [input.runId], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }),
      readMessage(raw) {
        const message = raw as SignalWorkerMessage;
        return message.type === 'done' ? { type: 'done', payload: message.output } : message;
      },
      exitedMessage: (code) =>
        code === 0
          ? 'Signal process exited before returning a result'
          : t(input.locale, 'signalProcExited', { code: code ?? 'unknown' }),
    });
  },
  async complete(transaction, job, input, output) {
    await transaction.signalRun.update({
      where: { id: input.runId, userId: job.userId, status: 'running' },
      data: {
        status: 'done',
        dataCutoff: output.dataCutoff,
        modelEquity: output.modelEquity,
        modelCash: output.modelCash,
        modelPositions: output.modelPositions as unknown as Prisma.InputJsonValue,
        signals: output.signals as unknown as Prisma.InputJsonValue,
        factorInputs: output.factorInputs as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
  },
  async fail(transaction, jobs, failure) {
    for (const job of jobs) {
      const id = job.signalRunId;
      if (!id) {
        continue;
      }
      await transaction.signalRun.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: { status: 'error', error: failure.message },
      });
    }
  },
  async recover(transaction, jobs) {
    const ids = jobs.map((job) => job.signalRunId).filter((id): id is string => !!id);
    if (ids.length > 0) {
      await transaction.signalRun.updateMany({
        where: { id: { in: ids }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
  },
  async afterCommit(_context, input, status) {
    if (status === 'done') {
      await initializeSignalAccounting(input.runId);
    }
    await notifySignalRun(input.runId);
  },
});

interface SignalWorkerOutput {
  dataCutoff: string;
  modelEquity: number;
  modelCash: number;
  modelPositions: ModelPositionSnapshot[];
  signals: SignalItem[];
  factorInputs: FactorInputSummary[];
}

type SignalWorkerMessage =
  | { type: 'log'; entry: LogLine }
  | { type: 'done'; output: SignalWorkerOutput }
  | { type: 'error'; message: string };
