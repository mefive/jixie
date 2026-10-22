import { signalWorkerMessageSchema, type SignalWorkerOutput } from './worker-protocol.js';
import { getDatabase } from '#infra/database/prisma.js';
import { fork } from 'node:child_process';
import { signalsRunJobPayloadSchema } from './job-payload.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { runWorker } from '#jobs/worker.js';
import { t } from '#i18n/messages.js';
import { notifySignalRun } from './notifier.js';
import { initializeSignalAccounting } from '../accounting/initialize.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./worker.boot.mjs', import.meta.url)
  : new URL('./worker.js', import.meta.url);

export const signalsRunLifecycle = {
  /**
   * 读取冻结部署输入并执行信号计算，供终态事务持久化。
   *
   * Compute signals from frozen deployment inputs for terminal persistence.
   */
  async onExecute(job, log) {
    const input = signalsRunJobPayloadSchema.parse(job.payload);
    if (input.runId !== job.signalRunId) {
      throw new Error('Signal payload does not match its persisted run');
    }
    const output = await runWorker<SignalWorkerOutput>({
      onLog: log,
      start: () =>
        fork(workerUrl, [input.runId], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }),
      readMessage(raw) {
        const message = signalWorkerMessageSchema.parse(raw);
        return message.type === 'done' ? { type: 'done', payload: message.output } : message;
      },
      exitedMessage: (code) =>
        code === 0
          ? 'Signal process exited before returning a result'
          : t(input.locale, 'signalProcExited', { code: code ?? 'unknown' }),
    });

    return { runId: input.runId, output };
  },
  async onSuccess(transaction, job, { runId, output }) {
    const current = await transaction.job.findFirst({
      where: { signalRunId: runId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (current?.id !== job.id) {
      throw new Error('Signal attempt has been superseded');
    }
    await transaction.signalRun.update({
      where: { id: runId, userId: job.userId },
      data: {
        resultVersion: output.resultVersion,
        modelAccounts: output.modelAccounts ?? undefined,
        intentSnapshot: output.futureSignals,
        dataCutoff: output.dataCutoff,
        modelEquity: output.modelEquity,
        modelCash: output.modelCash,
        modelPositions: output.modelPositions,
        signals: output.signals,
        factorInputs: output.factorInputs,
      },
    });
  },

  /**
   * 在信号结果与任务事务提交后执行通知和后续处理。
   *
   * Perform notification and follow-up work after the signal and job transaction commits.
   */
  async onCommitted(job, status) {
    const parsed = signalsRunJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success || parsed.data.runId !== job.signalRunId) {
      return;
    }
    const current = await getDatabase().job.findFirst({
      where: { signalRunId: parsed.data.runId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (current?.id === job.id) {
      if (status === 'done') {
        await initializeSignalAccounting(parsed.data.runId);
      }
      await notifySignalRun(parsed.data.runId);
    }
  },
} satisfies JobLifecycle<{ runId: string; output: SignalWorkerOutput }>;
