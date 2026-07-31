import type {
  BacktestConfig,
  Locale,
  LogLine,
  LogLevel,
  ModelPositionSnapshot,
  SignalItem,
} from '@jixie/shared';
import { codeConfigSchema } from '../strategy/code/schema.js';
import { prepareCustomFactors } from './prepare-custom-factors.js';
import { runWalledSignalCapture } from './walled-run.js';
import { prismaDataPort } from './prisma-port.js';
import { prisma } from '../lib/prisma.js';
import { t } from '../i18n/messages.js';

const runId = process.argv[2];
if (!runId || !process.send) {
  throw new Error('signal-worker must be spawned as an IPC child process with a run id');
}

const emit = (entry: LogLine) => process.send?.({ type: 'log', entry });
const systemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const userLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  const run = await prisma.signalRun.findUnique({
    where: { id: runId },
    include: { deployment: true },
  });
  if (!run) {
    throw new Error('Signal run not found');
  }

  const locale: Locale = run.deployment.locale === 'en' ? 'en' : 'zh';
  const config = codeConfigSchema.parse(run.deployment.config) as BacktestConfig;
  if (config.start >= run.tradeDate) {
    throw new Error('Deployment start date must be earlier than the signal date');
  }
  systemLog(t(locale, 'signalCaptureStart', { date: run.tradeDate, execDate: run.execDate }));

  const customFactors = await prepareCustomFactors(config.code, run.userId, locale);
  const output = await runWalledSignalCapture(
    {
      ...config,
      end: run.tradeDate,
      locale,
      customFactors,
    },
    prismaDataPort,
    systemLog,
    userLog,
  );
  const codes = [
    ...new Set([
      ...output.capture.signals.map((signal) => signal.code),
      ...output.capture.modelPositions.map((position) => position.code),
    ]),
  ];
  const [stocks, etfs] = await Promise.all([
    prisma.stockBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const names = new Map(
    [...stocks, ...etfs].map((instrument) => [instrument.tsCode, instrument.name]),
  );
  const signals: SignalItem[] = output.capture.signals.map((signal) => ({
    ...signal,
    name: names.get(signal.code) ?? signal.code,
  }));
  const modelPositions: ModelPositionSnapshot[] = output.capture.modelPositions.map((position) => ({
    ...position,
    name: names.get(position.code) ?? position.code,
  }));
  systemLog(t(locale, 'signalCaptureDone', { count: signals.length }));
  process.send({
    type: 'done',
    output: {
      dataCutoff: output.capture.tradeDate,
      modelEquity: output.capture.modelEquity,
      modelCash: output.capture.modelCash,
      modelPositions,
      signals,
    },
  });
} catch (error) {
  process.send({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  await prisma.$disconnect();
  process.disconnect();
}
