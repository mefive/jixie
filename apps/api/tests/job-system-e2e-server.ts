import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
const executions = new Set<Promise<void>>();
let database: typeof import('#infra/database/prisma.js').prisma | undefined;
let stopping = false;

async function listen(app: Hono) {
  return new Promise<string>((resolveBase) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (address) => {
      resolveBase(`http://127.0.0.1:${address.port}`);
    });
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
  await Promise.allSettled([...executions]);
  const { researchPythonLanguageService } = await import('#research/language/pyright-service.js');
  await researchPythonLanguageService.dispose();
  await database?.$disconnect();
  await rm(directory, { recursive: true, force: true });
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
    let content: string;
    if (system.includes('research-product curator')) {
      const input = JSON.parse(body.messages[1].content) as { evidence: Array<{ id: string }> };
      await delay(500);
      content = JSON.stringify({
        findings: [
          {
            category: 'method_candidate',
            title: '复权收益与滚动相关研究模板',
            summary: '将已有复权收盘价与滚动相关研究整理为可复现模板。',
            evidenceIds: input.evidence.map((item) => item.id),
            confidence: 0.9,
            expectedValue: '复用已有数据与计算方法。',
            changeSurface: ['研究方法模板'],
            suggestedAction: '人工审阅后整理模板。',
          },
        ],
      });
    } else {
      assert.ok(system.startsWith('You name A-share strategies.'), 'Unexpected model request');
      content = system.match(/currently called "([^"]+)"/)?.[1] ?? '每月定投策略';
    }
    return context.json({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    });
  });
  process.env.DEEPSEEK_BASE_URL = await listen(model);
  const { prisma } = await import('#infra/database/prisma.js');
  database = prisma;
  const { seedBuiltinFactors } = await import('#factor/definitions/seed.js');
  await seedBuiltinFactors();
  await seedMarket();
  await prisma.user.create({
    data: { id: 'curator-reader', email: 'jobs-curator@example.invalid' },
  });
  await prisma.agentConversation.create({
    data: {
      id: 'curator-evidence',
      userId: 'curator-reader',
      surface: 'research',
      title: '复权收益研究',
      messages: {
        create: {
          id: 'curator-question',
          role: 'user',
          sequence: 1,
          parts: [{ type: 'text', text: '如何复用复权收盘价，计算月收益与滚动相关？' }],
        },
      },
    },
  });
  const { registerJobLifecycles } = await import('#jobs/register.js');
  const { JobScheduler } = await import('#jobs/scheduler.js');
  const { JobService } = await import('#jobs/service.js');
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
  const app = buildApp();
  const webDist = resolve('../web/dist');
  const index = await readFile(join(webDist, 'index.html'), 'utf8');
  app.use('/assets/*', serveStatic({ root: webDist }));
  for (const path of ['/', '/strategy', '/factors', '/research', '/signals']) {
    app.get(path, (context) => context.html(index));
  }
  app.use('/*', serveStatic({ root: webDist }));
  const base = await listen(app);
  process.send!({
    type: 'ready',
    base,
    modelBase: process.env.DEEPSEEK_BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
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
  // Each short batch keeps fixture memory bounded. Later single-asset observations establish a
  // realistic holdout boundary and support the Signals journey's fixed trading dates.
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
}
