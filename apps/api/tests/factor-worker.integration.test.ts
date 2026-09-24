import { execFile, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import pkg from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BacktestConfig,
  FactorLanguage,
  FactorDependency,
  StrategyScanPayload,
} from '@jixie/shared';
import type { BacktestResult } from '#engine/types.js';
import { runWorker } from '#jobs/worker.js';
import { strategyScanWorkerMessageSchema } from '#strategy/scans/worker-protocol.js';

const executeFile = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const compiled = process.env.JIXIE_TEST_COMPILED === '1';
const execArgv = compiled ? [] : ['--conditions=development'];
const dates = ['20240102', '20240103', '20240104', '20240105'];
const userId = 'factor-worker-user';
const stock = '600000.SH';
const factorSources: Record<FactorLanguage, string> = {
  typescript: `
    if (typeof process !== 'undefined') throw new Error('factor initialization reached Node');
    export default defineFactor({ name: 'value', compute(bar) {
      if (typeof process !== 'undefined') throw new Error('factor computation reached Node');
      return bar.peTtm == null ? null : bar.peTtm * 2;
    } });
  `,
  python: `
from jixie import Factor
factor = Factor.cross_sectional(name="value")
@factor.compute
def compute(bar, ctx):
    return None if bar.pe_ttm is None else bar.pe_ttm * 2
`,
};

let directory: string;
let database: InstanceType<typeof pkg.PrismaClient>;
let environment: NodeJS.ProcessEnv;

function config(language: FactorLanguage, factorLanguage: FactorLanguage): BacktestConfig {
  const factor = `worker_${factorLanguage}`;
  const code =
    language === 'typescript'
      ? `
    export default defineStrategy({ name: 'worker', factors: ['${factor}'], watch: ['${stock}'],
      async onBar(ctx) {
        await ctx.universe();
        const value = ctx.factor('${factor}', '${stock}');
        if (value !== 20) throw new Error('unexpected factor value: ' + value);
        ctx.orderTargetPercent('${stock}', 0.5);
      }
    });
  `
      : `
from jixie import Strategy
strategy = Strategy(name="worker", factors=["${factor}"], watch=["${stock}"])
@strategy.on_bar
def on_bar(ctx):
    ctx.universe()
    assert ctx.factor("${factor}", "${stock}") == 20
    ctx.order_target_percent("${stock}", 0.5)
`;
  return {
    name: 'worker',
    language,
    runtimeVersion: language === 'typescript' ? 'ts-v1' : 'py-v1',
    code,
    start: dates[0],
    end: dates.at(-1)!,
    initialCash: 100_000,
  };
}

interface Completion {
  type: string;
  message?: string;
  payload?: BacktestResult;
  output?: {
    dataCutoff: string;
    factorInputs: Array<{ key: string; validAssets: number; meanValue: number }>;
  };
}

/** Resolve only after exit: successful IPC alone does not prove runtimes and DB handles were closed. */
function waitForExit<Payload = BacktestResult>(
  process: EventEmitter,
  stop: () => void,
): Promise<Omit<Completion, 'payload'> & { payload?: Payload }> {
  return new Promise((resolve, reject) => {
    let completion: (Omit<Completion, 'payload'> & { payload?: Payload }) | undefined;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error('Factor worker did not exit within 25 seconds');
      stop();
    }, 25_000);
    process.on('message', (message: Omit<Completion, 'payload'> & { payload?: Payload }) => {
      if (message.type !== 'log') {
        completion = message;
      }
    });
    process.once('error', (error: Error) => {
      failure = error;
      stop();
    });
    process.once('exit', (code: number | null) => {
      clearTimeout(timer);
      if (failure || code !== 0 || completion?.type !== 'done') {
        reject(failure ?? new Error(completion?.message ?? `Worker exit ${code} without a result`));
      } else {
        resolve(completion);
      }
    });
  });
}

function entry(path: string): URL {
  return new URL(
    `../${compiled ? 'dist/src' : 'src'}/${path}.${compiled ? 'js' : 'boot.mjs'}`,
    import.meta.url,
  );
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jixie-factor-worker-'));
  const databaseUrl = `file:${join(directory, 'fixture.db')}`;
  await writeFile(join(directory, 'fixture.db'), '');
  environment = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', NODE_OPTIONS: '' };
  if (!environment.JIXIE_SANDBOX_SOCKET) {
    environment.JIXIE_PYTHON_LOCAL = '1';
  }
  await executeFile(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)),
      'db',
      'push',
      '--skip-generate',
      '--schema',
      'prisma/schema.prisma',
    ],
    { cwd: apiDirectory, env: environment, timeout: 30_000 },
  );
  database = new pkg.PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await database.user.create({ data: { id: userId, email: 'factor-worker@example.invalid' } });
  await database.stockBasic.create({
    data: {
      tsCode: stock,
      symbol: '600000',
      name: 'Fixture',
      listDate: '20000101',
      listStatus: 'L',
    },
  });
  await database.tradeCal.createMany({
    data: dates.map((calDate) => ({ exchange: 'SSE', calDate, isOpen: 1 })),
  });
  await database.daily.createMany({
    data: dates.map((tradeDate, index) => ({
      tsCode: stock,
      tradeDate,
      open: 10 + index,
      high: 11 + index,
      low: 9 + index,
      close: 10 + index,
      vol: 100_000,
      amount: 100_000,
    })),
  });
  await database.adjFactor.createMany({
    data: dates.map((tradeDate) => ({ tsCode: stock, tradeDate, adjFactor: 1 })),
  });
  await database.dailyBasic.createMany({
    data: dates.map((tradeDate) => ({ tsCode: stock, tradeDate, peTtm: 10 })),
  });
  await database.indexDaily.createMany({
    data: dates.map((tradeDate, index) => ({
      tsCode: 'H00300.CSI',
      tradeDate,
      close: 4_000 + index * 10,
    })),
  });
  for (const language of ['typescript', 'python'] as const) {
    await database.factor.create({
      data: {
        id: `factor-${language}`,
        key: `worker_${language}`,
        userId,
        name: 'value',
        code: factorSources[language],
        language,
        runtimeVersion: language === 'typescript' ? 'ts-v1' : 'py-v1',
        status: 'published',
      },
    });
  }
}, 40_000);

afterAll(async () => {
  await database?.$disconnect();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe(`factor worker entries (${compiled ? 'compiled' : 'source'})`, () => {
  it('imports without consuming, recovers before startup, and drains queued jobs', async () => {
    const running = `startup-running-${compiled}`;
    const queued = `startup-queued-${compiled}`;
    await database.job.createMany({
      data: [
        { id: running, userId, kind: 'invalid-fixture', key: running, status: 'running' },
        { id: queued, userId, kind: 'invalid-fixture', key: queued, status: 'queued' },
      ],
    });
    await executeFile(
      process.execPath,
      [
        ...execArgv,
        ...(!compiled ? ['--import', 'tsx'] : []),
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { registerJobLifecycles } from '#jobs/register.js';
      import { JobScheduler } from '#jobs/scheduler.js';
      import { JobService } from '#jobs/service.js';
      import { prisma } from '#infra/database/prisma.js';
      assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: ${JSON.stringify(queued)} } })).status, 'queued');
      registerJobLifecycles();
      await JobService.recoverInterrupted();
      assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: ${JSON.stringify(running)} } })).status, 'stale');
      JobScheduler.initialize(JobService.execute);
      JobScheduler.wake();
      try { assert.equal(await JobService.waitForCompletion(${JSON.stringify(queued)}), 'error'); }
      finally { await prisma.$disconnect(); }
    `,
      ],
      { cwd: apiDirectory, env: environment, timeout: 20_000 },
    );
    expect((await database.job.findUniqueOrThrow({ where: { id: queued } })).error).toContain(
      'Unsupported queued job kind',
    );
  }, 25_000);

  it.each([
    'strategy/backtests/worker',
    'factor/execution/worker',
    'factor/correlations/worker',
    'strategy/scans/worker',
  ])(
    '%s loads its dependencies, reports invalid input, and exits',
    async (path) => {
      const worker = new Worker(entry(path), { workerData: {}, env: environment, execArgv });
      const messages: Array<{ type: string; message?: string }> = [];
      worker.on('message', (message) => messages.push(message));
      await expect(
        waitForExit(worker, () => {
          void worker.terminate();
        }),
      ).rejects.toThrow();
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'error', message: expect.any(String) }),
        ]),
      );
    },
    30_000,
  );

  it.each<[FactorLanguage, FactorLanguage]>([
    ['typescript', 'typescript'],
    ['typescript', 'python'],
    ['python', 'typescript'],
    ['python', 'python'],
  ])(
    'backtest worker: %s strategy and %s factor complete and exit',
    async (language, factorLanguage) => {
      const worker = new Worker(entry('strategy/backtests/worker'), {
        workerData: {
          config: config(language, factorLanguage),
          userId,
          strategyId: 'fixture',
          locale: 'en',
        },
        env: environment,
        execArgv,
      });
      const completion = await waitForExit(worker, () => {
        void worker.terminate();
      });
      expect(completion.payload?.nav).toHaveLength(dates.length);
      expect(completion.payload?.trades).toBeGreaterThan(0);
      expect(completion.payload?.factorDependencies?.[0]).toMatchObject({
        key: `worker_${factorLanguage}`,
        language: factorLanguage,
      });
    },
    30_000,
  );

  it.each<FactorLanguage>(['typescript', 'python'])(
    'scan worker runs consecutive simulations with the %s factor and exits',
    async (language) => {
      const strategyConfig = config('typescript', language);
      const worker = new Worker(entry('strategy/scans/worker'), {
        workerData: {
          config: strategyConfig,
          spec: {
            view: 'capacity',
            dimensions: [{ key: 'initialCash', values: [100_000, 200_000, 300_000] }],
          },
          parameters: {},
          ranges: { full: { start: strategyConfig.start, end: strategyConfig.end } },
          userId,
          locale: 'en',
        },
        env: environment,
        execArgv,
      });
      const completion = await waitForExit<StrategyScanPayload>(worker, () => {
        void worker.terminate();
      });
      expect(completion.payload?.cells).toHaveLength(3);
      for (const cell of completion.payload!.cells) {
        expect(cell.full?.days).toBe(dates.length);
        expect(cell.full?.trades).toBeGreaterThan(0);
      }
    },
    30_000,
  );

  it('terminates the scan thread through the common worker lifecycle on a log failure', async () => {
    let worker: Worker | undefined;
    let exited = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        runWorker<StrategyScanPayload>({
          start: () => {
            const strategyConfig = config('typescript', 'typescript');
            worker = new Worker(entry('strategy/scans/worker'), {
              workerData: {
                config: strategyConfig,
                spec: {
                  view: 'capacity',
                  dimensions: [{ key: 'initialCash', values: [100_000, 200_000, 300_000] }],
                },
                parameters: {},
                ranges: { full: { start: strategyConfig.start, end: strategyConfig.end } },
                userId,
                locale: 'en',
              },
              env: environment,
              execArgv,
            });
            worker.once('exit', () => {
              exited = true;
            });
            timer = setTimeout(() => {
              void worker?.terminate();
            }, 25_000);
            return worker;
          },
          onLog: () => {
            throw new Error('scan log interrupted');
          },
          readMessage: (message) => strategyScanWorkerMessageSchema.parse(message),
          exitedMessage: (code) => `Unexpected scan exit ${code}`,
        }),
      ).rejects.toThrow('scan log interrupted');
      expect(exited).toBe(true);
    } finally {
      clearTimeout(timer);
      if (worker && !exited) {
        await worker.terminate();
      }
    }
  }, 30_000);

  it.each<FactorLanguage>(['typescript', 'python'])(
    'signal worker captures %s factor observations and exits',
    async (language) => {
      const strategyId = `strategy-${language}`;
      const deploymentId = `deployment-${language}`;
      const runId = `signal-${language}`;
      const strategyConfig = config('typescript', language);
      const dependencies: FactorDependency[] = [
        {
          factorId: `factor-${language}`,
          key: `worker_${language}`,
          name: 'value',
          analysisKind: 'cross_sectional',
          codeHash: createHash('sha256').update(factorSources[language]).digest('hex'),
          approvedReportId: null,
          language,
          runtimeVersion: language === 'typescript' ? 'ts-v1' : 'py-v1',
        },
      ];
      await database.strategy.create({
        data: {
          id: strategyId,
          userId,
          name: strategyId,
          config: strategyConfig as unknown as pkg.Prisma.InputJsonValue,
        },
      });
      await database.strategyDeployment.create({
        data: {
          id: deploymentId,
          userId,
          strategyId,
          strategyName: strategyId,
          status: 'active',
          locale: 'en',
          config: strategyConfig as unknown as pkg.Prisma.InputJsonValue,
          codeHash: 'fixture',
          factorDependencies: dependencies as unknown as pkg.Prisma.InputJsonValue,
        },
      });
      await database.signalRun.create({
        data: {
          id: runId,
          userId,
          deploymentId,
          strategyId,
          tradeDate: dates.at(-1)!,
          execDate: '20240108',
          legacyStatus: 'running',
          factorDependencies: dependencies as unknown as pkg.Prisma.InputJsonValue,
        },
      });
      const child = fork(entry('signals/runs/worker'), [runId], {
        cwd: apiDirectory,
        env: environment,
        execArgv,
        silent: true,
      });
      const completion = await waitForExit(child, () => {
        child.kill('SIGKILL');
      });
      expect(completion.output?.dataCutoff).toBe(dates.at(-1));
      expect(completion.output?.factorInputs).toEqual([
        expect.objectContaining({ key: `worker_${language}`, validAssets: 1, meanValue: 20 }),
      ]);
    },
    30_000,
  );
});
