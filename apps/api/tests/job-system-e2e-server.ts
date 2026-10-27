import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

// Real HTTP, scheduler, Workers and persistence; only market observations and the external model
// are controlled fixtures. Never load the developer's .env or database.
assert.ok(process.send);
const directory = await mkdtemp(join(tmpdir(), 'jixie-jobs-browser-'));
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
process.env.NODE_ENV = 'test';
process.env.DEEPSEEK_API_KEY = 'local-e2e';
process.env.DEEPSEEK_MODEL = 'local-e2e';
process.env.JIXIE_PYTHON_LOCAL = '1';
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
const servers: Server[] = [];
const requests = new Set<Promise<Response>>();
const executions = new Set<Promise<void>>();
let database: typeof import('#infra/database/prisma.js').prisma | undefined;
let stopping = false;

async function listen(app: Hono) {
  return new Promise<string>((resolveBase) => {
    const server = serve(
      {
        fetch: (request, environment) => {
          const response = Promise.resolve(app.fetch(request, environment));
          requests.add(response);
          void response.then(
            () => requests.delete(response),
            () => requests.delete(response),
          );

          return response;
        },
        hostname: '127.0.0.1',
        port: 0,
      },
      (address) => resolveBase(`http://127.0.0.1:${address.port}`),
    );
    servers.push(server as Server);
  });
}

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const server of servers) {
    const closed = new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    server.closeAllConnections();
    await closed;
  }
  // Disconnected clients can leave handlers initializing resources after their sockets close.
  console.log(`[job-fixture] draining ${requests.size} requests and ${executions.size} executions`);
  await Promise.allSettled([...requests]);
  await Promise.allSettled([...executions]);

  // reset 只清空变量；验收结束还需显式关闭文档池中的 Python 进程。
  // Reset clears variables; fixture teardown must also close pooled document Python processes.
  const { researchSandboxPool } = await import('#research/sandbox/research-sandbox-pool.js');
  const documents = database
    ? await database.researchDocument.findMany({ select: { id: true } })
    : [];

  for (const document of documents) {
    researchSandboxPool.close(document.id);
  }

  const { researchPythonLanguageService } =
    await import('#research/language/research-python-language-service.js');
  await researchPythonLanguageService.dispose();
  console.log('[job-fixture] language service disposed');
  await database?.$disconnect();
  await rm(directory, { recursive: true, force: true });
  console.log('[job-fixture] database disconnected and temporary files removed');
  process.disconnect?.();
}
process.once('SIGTERM', () => void stop());
process.once('disconnect', () => void stop());
process.on('message', (message: { type: string }) => {
  if (message.type === 'stop') {
    void stop();
  }
});

try {
  await writeFile(join(directory, 'test.db'), '');
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve('prisma/schema.prisma'),
    ],
    { stdio: 'pipe' },
  );
  const model = new Hono();
  model.post('/chat/completions', async (context) => {
    const body = await context.req.json<{ messages: Array<{ content: string }> }>();
    const system = body.messages[0].content;
    assert.ok(system.startsWith('You name A-share strategies.'), 'Unexpected model request');
    const content = system.match(/currently called "([^"]+)"/)?.[1] ?? '每月定投策略';

    return context.json({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    });
  });
  process.env.DEEPSEEK_BASE_URL = await listen(model);
  const { prisma, withDatabase } = await import('#infra/database/prisma.js');
  database = prisma;
  await withDatabase(prisma, async () => {
    const { seedBuiltinFactors } = await import('#factor/definitions/seed.js');
    await seedBuiltinFactors();
    await seedMarket();
    const { registerJobLifecycles } = await import('#jobs/register.js');
    const { JobScheduler } = await import('#jobs/job-scheduler.js');
    const { JobService } = await import('#jobs/job-service.js');
    registerJobLifecycles();
    await JobService.recoverInterrupted();
    JobScheduler.initialize(async (jobId) => {
      const execution = JobService.execute(jobId);
      executions.add(execution);
      try {
        await execution;
      } finally {
        executions.delete(execution);
      }
    });
    JobScheduler.wake();
    const { buildApp } = await import('../src/server.js');
    // 对齐反向代理：API 只接收 /api，首页及历史路由由 Web 提供。
    // Mirror the reverse proxy: API handles /api; Web owns the homepage and history fallback.
    const api = buildApp();
    const app = new Hono();
    const webDist = resolve('../web/dist');
    const index = await readFile(join(webDist, 'index.html'), 'utf8');
    if (process.env.JIXIE_JOB_E2E_ONLY?.split(',').includes('docs-help')) {
      const docsDist = resolve('../docs/dist');
      const docsIndex = await readFile(join(docsDist, 'docs/index.html'), 'utf8');
      app.use('/docs/*', serveStatic({ root: docsDist }));
      app.get('/docs/*', (context) => context.html(docsIndex));
      for (const path of ['/learn', '/help/*', '/sdk']) {
        app.get(path, (context) => context.html(index));
      }
    }
    app.use('/assets/*', serveStatic({ root: webDist }));
    for (const path of ['/', '/strategy', '/factors', '/research', '/market', '/valuation']) {
      app.get(path, (context) => context.html(index));
    }
    app.use('/*', serveStatic({ root: webDist }));
    app.route('/', api);
    app.get('/*', (context) =>
      context.req.path.startsWith('/api/') ? context.notFound() : context.html(index),
    );
    const base = await listen(app);
    process.send!({
      type: 'ready',
      base,
      modelBase: process.env.DEEPSEEK_BASE_URL,
      databaseUrl: process.env.DATABASE_URL,
    });
  });
} catch (error) {
  console.error(error);
  process.send!({ type: 'error', message: String(error) });
  await stop();
  process.exitCode = 1;
}

async function seedMarket() {
  const prisma = database!;
  const stocks = Array.from({ length: 160 }, (_, index) => ({
    tsCode: index === 0 ? '600519.SH' : `${String(600000 + index)}.SH`,
    symbol: index === 0 ? '600519' : String(600000 + index),
    name: index === 0 ? '贵州茅台' : `Fixture ${index}`,
    listDate: '20000101',
    listStatus: 'L',
  }));
  await prisma.stockBasic.createMany({ data: stocks });
  await prisma.stockNameHistory.createMany({
    data: stocks.map((stock) => ({
      tsCode: stock.tsCode,
      name: stock.name,
      startDate: '20000101',
    })),
  });
  await prisma.etfBasic.create({
    data: {
      tsCode: '510300.SH',
      name: '沪深300ETF',
      listDate: '20120101',
      listStatus: 'L',
      exchange: 'SSE',
      sameDayTurnover: false,
    },
  });
  const dates: string[] = [];
  for (
    const date = new Date('2023-01-02T00:00:00Z');
    date <= new Date('2026-09-24T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      dates.push(date.toISOString().slice(0, 10).replaceAll('-', ''));
    }
  }
  await prisma.tradeCal.createMany({
    data: dates.map((calDate, index) => ({
      exchange: 'SSE',
      calDate,
      isOpen: 1,
      pretradeDate: dates[index - 1],
    })),
  });
  // 指数范围验收需要持续更新的历史快照，不能把 2023 年成员沿用到后续年份。
  // Scope-aware analyses need dated snapshots rather than stale 2023 memberships.
  const membershipDates = dates.filter(
    (date, index) => index === 0 || date.slice(0, 6) !== dates[index - 1]!.slice(0, 6),
  );
  await prisma.indexWeight.createMany({
    data: membershipDates.flatMap((tradeDate) =>
      stocks.map((stock) => ({
        indexCode: '000300.SH',
        conCode: stock.tsCode,
        tradeDate,
        weight: 100 / stocks.length,
      })),
    ),
  });

  const { DATASET_POLICIES } = await import('#market/synchronization/policies.js');
  await prisma.datasetSyncPartition.createMany({
    data: ['calendar', 'stock-prices', 'stock-adjustments', 'stock-valuations'].map((dataset) => ({
      id: `fixture:${dataset}`,
      dataset,
      scope: dataset === 'calendar' ? 'SSE' : 'all',
      startDate: dates[0]!,
      endDate: dates.at(-1)!,
      policyVersion: DATASET_POLICIES.find((policy) => policy.dataset === dataset)!.version,
      status: 'complete',
    })),
  });
  // Each short batch keeps fixture memory bounded. Later single-asset observations establish a
  // coverage for recent analyses and historical backtest dates.
  for (let offset = 0; offset < dates.length; offset += 20) {
    const rows = dates.slice(offset, offset + 20).flatMap((tradeDate, day) =>
      (tradeDate < '20250101' ? stocks : stocks.slice(0, 1)).map((stock, index) => {
        const close =
          stock.tsCode === '600519.SH' && tradeDate >= '20260701'
            ? 1320
            : 10 +
              index / 10 +
              (offset + day) * (0.001 + index * 0.00005) +
              Math.sin((offset + day) / 7 + index) * 0.02;
        return {
          tsCode: stock.tsCode,
          tradeDate,
          close,
          open: close,
          high: close * 1.01,
          low: close * 0.99,
          preClose: close,
          vol: 1_000_000,
          amount: 100_000 + index * 1_000,
        };
      }),
    );
    await prisma.daily.createMany({ data: rows });
    await prisma.adjFactor.createMany({
      data: rows.map(({ tsCode, tradeDate }) => ({ tsCode, tradeDate, adjFactor: 1 })),
    });
    await prisma.dailyBasic.createMany({
      data: rows.map(({ tsCode, tradeDate }, index) => ({
        tsCode,
        tradeDate,
        peTtm: 5 + (index % 160),
        pb: 1 + (index % 37) / 10,
        totalMv: 100_000 + (index % 160) * 10_000,
        circMv: 80_000 + (index % 160) * 8_000,
      })),
    });
    await prisma.stkLimit.createMany({
      data: rows.map(({ tsCode, tradeDate, close }) => ({
        tsCode,
        tradeDate,
        upLimit: close * 1.1,
        downLimit: close * 0.9,
      })),
    });
  }
  const etfRows = dates.map((tradeDate, index) => ({
    tsCode: '510300.SH',
    tradeDate,
    close: 3 + index * 0.002,
    open: 3 + index * 0.002,
    high: 3.05 + index * 0.002,
    low: 2.95 + index * 0.002,
    vol: 100_000,
    amount: 20_000,
  }));
  await prisma.etfDaily.createMany({ data: etfRows });
  await prisma.etfAdjFactor.createMany({
    data: dates.map((tradeDate) => ({ tsCode: '510300.SH', tradeDate, adjFactor: 1 })),
  });
  await prisma.indexDaily.createMany({
    data: dates.map((tradeDate, index) => ({
      tsCode: 'H00300.CSI',
      tradeDate,
      close: 4000 + index,
    })),
  });

  // 官方估值使用独立原始表，验收确认天气删除后仍可读取和绘图。
  // Official valuation retains its raw tables and remains readable and chartable after retirement.
  const valuationDates = dates.slice(-60);
  for (const tsCode of ['000300.SH', '000905.SH']) {
    await prisma.indexDaily.createMany({
      data: valuationDates.map((tradeDate, index) => ({ tsCode, tradeDate, close: 4000 + index })),
    });
    await prisma.indexDailyBasic.createMany({
      data: valuationDates.map((tradeDate, index) => ({
        tsCode,
        tradeDate,
        pe: 11 + index / 100,
        peTtm: 12 + index / 100,
        pb: 1.2 + index / 1000,
      })),
    });
  }

  const futureDates = dates.filter((date) => date >= '20260601' && date <= '20260630');
  await prisma.futureContract.create({
    data: {
      tsCode: 'IF2607.CFX',
      symbol: 'IF2607',
      productCode: 'IF',
      name: 'Synthetic CSI 300 future',
      exchange: 'CFFEX',
      multiplier: 300,
      listDate: '20260101',
      delistDate: '20260717',
    },
  });
  await prisma.futureDaily.createMany({
    data: futureDates.map((tradeDate, index) => ({
      tsCode: 'IF2607.CFX',
      tradeDate,
      open: 4000 + index,
      high: 4002 + index,
      low: 3998 + index,
      close: 4001 + index,
      settle: 4001 + index,
      volume: 100000,
      amount: 100000,
      openInterest: 200000,
    })),
  });
  await prisma.futureMapping.createMany({
    data: futureDates.map((tradeDate) => ({
      continuousCode: 'IF.CFX',
      tradeDate,
      mappedTsCode: 'IF2607.CFX',
    })),
  });
  await prisma.futureSettlement.createMany({
    data: futureDates.map((tradeDate) => ({
      tsCode: 'IF2607.CFX',
      tradeDate,
      longMarginRate: 0.12,
      shortMarginRate: 0.12,
    })),
  });
  await prisma.datasetSyncPartition.createMany({
    data: [
      ...['IF', 'IH', 'IC', 'IM'].map((product) => ({
        dataset: 'future-contracts',
        scope: `CFFEX|${product}`,
      })),
      { dataset: 'future-prices', scope: 'IF2607.CFX' },
      { dataset: 'future-settlements', scope: 'IF2607.CFX' },
      { dataset: 'future-mappings', scope: 'IF.CFX' },
    ].map(({ dataset, scope }) => ({
      id: `fixture:${dataset}:${scope}`,
      dataset,
      scope,
      startDate: futureDates[0]!,
      endDate: futureDates.at(-1)!,
      policyVersion: 'sync-v1',
      status: 'complete',
    })),
  });
  const { publishFutureMarketDate } = await import('#market/futures/publication.js');
  for (const date of futureDates) {
    await publishFutureMarketDate(date);
  }
}
