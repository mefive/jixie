import { fork } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import type {
  BacktestConfig,
  Locale,
  LogLine,
  StrategyScanPayload,
  StrategyParamValue,
  StrategyScanSpec,
} from '@jixie/shared';
import { t } from '../i18n/index.js';
import { prisma } from '../lib/prisma.js';
import { executeStrategyScan } from '../strategy/scan.js';
import { prepareCustomFactors } from './prepare-custom-factors.js';
import type { BacktestResult } from './types.js';

const port = parentPort;
if (!port) {
  throw new Error('strategy-scan-worker must be spawned as a worker thread');
}

type ScanRanges =
  | { full: { start: string; end: string } }
  | {
      inSample: { start: string; end: string };
      outOfSample: { start: string; end: string };
    };

const { config, spec, parameters, ranges, userId, locale } = workerData as {
  config: BacktestConfig;
  spec: StrategyScanSpec;
  parameters: Record<string, StrategyParamValue>;
  ranges: ScanRanges;
  userId: string;
  locale: Locale;
};

const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const cellWorkerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./strategy-scan-cell-worker.boot.mjs', import.meta.url)
  : new URL('./strategy-scan-cell-worker.js', import.meta.url);

try {
  const customFactors = await prepareCustomFactors(config.code, userId, locale);
  const payload: StrategyScanPayload = await executeStrategyScan({
    spec,
    parameters,
    ranges,
    run: (params, range) =>
      runScanCell({
        config: { ...config, start: range.start, end: range.end },
        customFactors,
        paramOverrides: params,
        locale,
      }),
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
  port.postMessage({ type: 'done', payload });
} catch (error) {
  port.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  await prisma.$disconnect();
}

function runScanCell(data: {
  config: BacktestConfig;
  customFactors: Awaited<ReturnType<typeof prepareCustomFactors>>;
  paramOverrides: Record<string, StrategyParamValue>;
  locale: Locale;
}): Promise<BacktestResult> {
  return new Promise((resolve, reject) => {
    const child = fork(cellWorkerUrl, [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let result: BacktestResult | undefined;
    let error: string | undefined;

    child.on('message', (message: { type: string; result?: BacktestResult; message?: string }) => {
      if (message.type === 'done') {
        result = message.result;
      } else if (message.type === 'error') {
        error = message.message ?? 'parameter scan cell failed';
      }
    });
    child.on('error', (childError) => {
      error = childError.message;
    });
    child.on('exit', (code, signal) => {
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
