import { strategyScanWorkerMessageSchema, type StrategyScanControl } from './worker-protocol.js';
import { Worker } from 'node:worker_threads';
import type { StrategyScanPayload } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { t } from '#i18n/messages.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { runWorker } from '#jobs/worker.js';
import { strategyScanJobPayloadSchema, type StrategyScanWorkerInput } from './job-payload.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./strategy-scan-worker.boot.mjs', import.meta.url)
  : new URL('./strategy-scan-worker.js', import.meta.url);

export const strategyScanLifecycle = {
  async onExecute(job, log) {
    const input = strategyScanJobPayloadSchema.parse(job.payload);
    if (input.reportId !== job.strategyScanReportId || input.userId !== job.userId) {
      throw new Error('Strategy scan payload does not match its persisted owner or report');
    }
    const result = await runWorker<StrategyScanPayload>({
      onLog: log,
      start: () => {
        const worker = new Worker(workerUrl, {
          workerData: {
            config: input.config,
            spec: input.spec,
            parameters: input.parameters,
            ranges: input.ranges,
            userId: input.userId,
            locale: input.locale,
          } satisfies StrategyScanWorkerInput,
        });
        // Stop the owning scan thread cooperatively so it can reap its active cell process.
        const exited = new Promise<number>((resolve) => worker.once('exit', resolve));
        worker.terminate = () => {
          worker.postMessage({ type: 'stop' } satisfies StrategyScanControl);
          return exited;
        };
        return worker;
      },
      readMessage: (raw) => strategyScanWorkerMessageSchema.parse(raw),
      exitedMessage: (code) =>
        t(input.locale, 'strategyScanProcExited', { code: code ?? 'unknown' }),
    });
    const output = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;

    return { reportId: input.reportId, output };
  },
  async onSuccess(transaction, job, { reportId, output }) {
    await transaction.strategyScanReport.update({
      where: { id: reportId, userId: job.userId },
      data: { payload: output },
    });
  },
} satisfies JobLifecycle<{
  reportId: string;
  output: Prisma.InputJsonValue;
}>;
