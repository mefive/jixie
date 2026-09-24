import { strategyScanWorkerInputSchema } from './job-payload.js';
import { scanCellWorkerMessageSchema } from './cell-worker-protocol.js';
import { strategyScanControlSchema } from './worker-protocol.js';
import type { StrategyScanWorkerMessage } from './worker-protocol.js';
import type { BacktestResult } from '#engine/types.js';
import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import { errorMessage } from '#infra/errors.js';
import type {
  BacktestConfig,
  Locale,
  LogLine,
  StrategyParamValue,
  StrategyScanPayload,
} from '@jixie/shared';
import { fork, type ChildProcess } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import { prepareStrategyFactors, type PreparedStrategyFactors } from '../factor-inputs/prepare.js';
import { executeStrategyScan, scanCellOverrides } from './scan.js';

const port = parentPort;
if (!port) {
  throw new Error('strategy-scan-worker must be spawned as a worker thread');
}

const send = (message: StrategyScanWorkerMessage) => port.postMessage(message);

const emit = (entry: LogLine) => send({ type: 'log', entry });
const cellWorkerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./strategy-scan-cell-worker.boot.mjs', import.meta.url)
  : new URL('./strategy-scan-cell-worker.js', import.meta.url);

let activeCell: ChildProcess | undefined;
let stopRequested = false;
port.on('message', (message: unknown) => {
  if (strategyScanControlSchema.safeParse(message).success) {
    stopRequested = true;
    activeCell?.kill('SIGKILL');
  }
});

let locale: Locale = 'zh';
try {
  const input = strategyScanWorkerInputSchema.parse(workerData);
  const { config, spec, parameters, ranges, userId } = input;
  locale = input.locale;
  const { modules: customFactors } = await prepareStrategyFactors(config.code, userId);
  const payload: StrategyScanPayload = await executeStrategyScan({
    spec,
    parameters,
    ranges,
    run: (params, range) => {
      const overrides = scanCellOverrides(spec, params);
      return runScanCell({
        config: {
          ...config,
          start: range.start,
          end: range.end,
          initialCash: overrides.initialCash ?? config.initialCash,
        },
        customFactors,
        paramOverrides: overrides.paramOverrides,
        locale,
      });
    },
    onCellStart: (index, total, params) => {
      const values = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      emit({
        source: 'system',
        level: 'info',
        text: t(locale, 'strategyScanCell', { current: index + 1, total, values }),
      });
    },
  });
  send({ type: 'done', payload });
} catch (error) {
  send({
    type: 'error',
    message: errorMessage(error, locale),
  });
} finally {
  await prisma.$disconnect();
  port.close();
}

function runScanCell(data: {
  config: BacktestConfig;
  customFactors: PreparedStrategyFactors['modules'];
  paramOverrides: Record<string, StrategyParamValue>;
  locale: Locale;
}): Promise<BacktestResult> {
  if (stopRequested) {
    return Promise.reject(new Error('Parameter scan stopped'));
  }
  return new Promise((resolve, reject) => {
    const child = fork(cellWorkerUrl, [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    activeCell = child;
    let result: BacktestResult | undefined;
    let error: string | undefined;

    child.on('message', (raw: unknown) => {
      if (error || result) {
        return;
      }
      try {
        const message = scanCellWorkerMessageSchema.parse(raw);
        if (message.type === 'done') {
          result = message.result;
        } else {
          error = message.message;
          child.kill('SIGKILL');
        }
      } catch (decodeError) {
        error = decodeError instanceof Error ? decodeError.message : String(decodeError);
        child.kill('SIGKILL');
      }
    });
    child.on('error', (childError) => {
      error = childError.message;
    });
    child.on('close', (code, signal) => {
      activeCell = undefined;
      if (error) {
        reject(new Error(error));
      } else if (code !== 0 || signal) {
        reject(
          new Error(
            `parameter scan cell process exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
          ),
        );
      } else if (!result) {
        reject(new Error('parameter scan cell process exited without a result'));
      } else {
        resolve(result);
      }
    });
    child.send(data);
  });
}
