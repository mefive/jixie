import {
  embeddedModelResponse,
  seedEmbeddedStrategies,
  settleEmbeddedExecutions,
} from './embedded-analysis-e2e-fixture.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { FactorQuestionContextV1, FactorReport, Locale } from '@jixie/shared';

// Only the external model is replaced. HTTP, auth, report mapping, Agent execution,
// streaming and persistence use the application code against a private temporary database.
assert.ok(process.send, 'Launch this test fixture through its browser runner.');
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const webDist = resolve(apiDirectory, '../web/dist');
const indexHtml = await readFile(join(webDist, 'index.html'), 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'jixie-factor-question-journey-'));
const databaseUrl = `file:${join(directory, 'test.db')}`;
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.DEEPSEEK_API_KEY = 'local-e2e-provider';
process.env.DEEPSEEK_MODEL = 'factor-question-e2e';
process.env.DEEPSEEK_AGENT_MODEL = 'factor-question-e2e';

interface ModelMessage {
  role: string;
  content: string;
}
const embeddedJourney = process.env.JIXIE_EMBEDDED_E2E === '1';
if (embeddedJourney) {
  process.env.JIXIE_PYTHON_LOCAL = '1';
}
const modelRequests: Array<{ context: FactorQuestionContextV1; question: string }> = [];
const failures: string[] = [];
const resumedReports = new Set<string>();
const pendingAnswers = new Map<string, () => void>();
let applicationServer: Server | undefined;
let modelServer: Server | undefined;
let database: typeof import('#infra/database/prisma.js').prisma | undefined;
let stopping = false;

async function listen(app: Hono): Promise<{ server: Server; base: string }> {
  return new Promise((resolveServer, reject) => {
    const server = serve(
      { fetch: app.fetch, createServer, hostname: '127.0.0.1', port: 0 },
      (address) => {
        resolveServer({ server: server as Server, base: `http://127.0.0.1:${address.port}` });
      },
    );
    server.once('error', reject);
  });
}

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (database) {
    const { cancel } = await import('#agent/turns/bus.js');
    const active = await database.agentTurn.findMany({
      where: { status: 'running' },
      select: { id: true, conversation: { select: { userId: true } } },
    });
    for (const turn of active) {
      cancel(turn.id, turn.conversation.userId);
    }
  }
  for (const release of pendingAnswers.values()) {
    release();
  }
  if (database) {
    const deadline = Date.now() + 3_000;
    while (await database.agentTurn.count({ where: { status: 'running' } })) {
      if (Date.now() >= deadline) {
        process.exitCode = 1;
        console.error('An Agent turn did not stop before fixture cleanup.');
        break;
      }
      await delay(30);
    }
    if (embeddedJourney) {
      const { researchRuntimePool } = await import('#research/runtime/pool.js');
      const { cancelEmbeddedRun } = await import('#research/embedded/cancel.js');
      const active = await database.researchExecution.findMany({
        where: { status: { in: ['queued', 'running'] }, embeddedVersionId: { not: null } },
        include: { embeddedVersion: { include: { analysis: true } } },
      });
      for (const run of active) {
        await cancelEmbeddedRun(
          run.embeddedVersion!.analysis.userId,
          run.embeddedVersion!.analysisId,
          run.id,
        );
      }
      for (const document of await database.researchDocument.findMany({ select: { id: true } })) {
        researchRuntimePool.close(document.id);
      }
      await settleEmbeddedExecutions();
      const { researchPythonLanguageService } =
        await import('#research/language/pyright-service.js');
      await researchPythonLanguageService.dispose();
    }
    // Completed turns keep a replay TTL timer; test teardown must release that timer too.
    const { _resetForTest } = await import('#agent/turns/bus.js');
    _resetForTest();
  }
  for (const server of [applicationServer, modelServer]) {
    if (server) {
      const closed = new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
      server.closeAllConnections();
      await closed;
    }
  }
  await database?.$disconnect();
  await rm(directory, { recursive: true, force: true });
  if (process.connected) {
    process.disconnect();
  }
}

process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
process.once('disconnect', () => void stop());

try {
  await writeFile(join(directory, 'test.db'), '');
  const privateSchema = join(directory, 'prisma/schema.prisma');
  await mkdir(join(directory, 'prisma'));
  await copyFile(join(apiDirectory, 'prisma/schema.prisma'), privateSchema);
  await cp(join(apiDirectory, 'prisma/migrations'), join(directory, 'prisma/migrations'), {
    recursive: true,
  });
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      privateSchema,
    ],
    { cwd: directory, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
  );

  const provider = new Hono();
  provider.post('/chat/completions', async (context) => {
    try {
      if (embeddedJourney) {
        return await embeddedModelResponse(context);
      }
      const body = await context.req.json<{ messages: ModelMessage[]; stream: boolean }>();
      assert.equal(body.stream, true);
      const match = body.messages[0].content.match(
        /<factor_question_context>([\s\S]*?)<\/factor_question_context>/,
      );
      assert.ok(match, 'The real Agent profile must supply the saved question context.');
      const snapshot = JSON.parse(match[1]) as FactorQuestionContextV1;
      const question = body.messages.at(-1)?.content ?? '';
      const report = snapshot.report;
      assert.ok(report);
      const summary = report.summary as {
        spec: { start: string; end: string };
        metrics: { rankIc: number };
      };
      assert.equal(snapshot.factor.key, 'ep');
      assert.equal(typeof summary.metrics.rankIc, 'number');
      assert.ok(snapshot.factor.source.includes('peTtm'));
      assert.ok(!('payload' in summary), 'The QA profile should receive a summary, not raw data.');
      const previousAnswer = body.messages.find((message) => message.role === 'assistant');
      const previousQuestion = body.messages.find(
        (message) => message.role === 'user' && message !== body.messages.at(-1),
      );
      if (summary.spec.start === '20230101') {
        assert.ok(previousAnswer?.content.includes('0.0400'), 'Follow-up lost the earlier answer.');
        assert.ok(
          previousQuestion?.content.includes('ep-2020-2022-'),
          "Follow-up lost the earlier question's report reference.",
        );
      } else {
        assert.equal(summary.spec.start, '20200101');
        assert.equal(previousAnswer, undefined);
      }
      modelRequests.push({ context: snapshot, question });
      const english = /What does|How does/.test(question);
      const value = summary.metrics.rankIc.toFixed(4);
      const years = `${summary.spec.start.slice(0, 4)}–${summary.spec.end.slice(0, 4)}`;
      const answer = previousAnswer
        ? english
          ? `The selected ${years} report has a mean Rank IC of **${value}**, compared with **0.0400** in the earlier report. The association is weaker in this sample. Different sample periods alone do not establish factor decay; inspect period-level results and uncertainty before drawing that conclusion. This answer uses saved report summaries and performs no new calculation.`
          : `当前 ${years} 报告的 Rank IC 均值为 **${value}**，前一份报告为 **0.0400**。本样本中的关联较弱，但仅凭两个区间不能断言因子衰减，还需要检查分期表现和估计的不确定性。本轮解释已有报告摘要，没有重新计算。`
        : english
          ? `The selected ${years} report has a mean Rank IC of **${value}**. Higher earnings yield is positively associated with subsequent returns in this sample. That mean alone does not establish stability or profitability. This answer has only the saved report summary; period-level results and uncertainty are needed for a stronger conclusion.`
          : `这份 ${years} 报告的 Rank IC 均值为 **${value}**，表示样本中盈利收益率较高的股票，其后续收益排序平均也较高。仅凭均值不能证明稳定有效或能够盈利；本轮只有已保存的报告摘要，还需要检查分期表现和估计的不确定性。`;

      return streamSSE(context, async (stream) => {
        // Hold the follow-up at the external-provider boundary until the reader has reloaded.
        // No special words in the user's question control this fault/timing injection.
        if (previousAnswer && !resumedReports.has(report.id)) {
          await new Promise<void>((release) => pendingAnswers.set(report.id, release));
          pendingAnswers.delete(report.id);
        }
        await delay(100);
        await stream.writeSSE({
          data: JSON.stringify({
            id: `completion-${modelRequests.length}`,
            object: 'chat.completion.chunk',
            created: 0,
            model: 'factor-question-e2e',
            choices: [{ index: 0, delta: { content: answer }, finish_reason: null }],
          }),
        });
        await stream.writeSSE({
          data: JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        });
        await stream.writeSSE({ data: '[DONE]' });
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      return context.json({ error: { message: failures.at(-1) } }, 400);
    }
  });
  const localModel = await listen(provider);
  modelServer = localModel.server;
  process.env.DEEPSEEK_BASE_URL = localModel.base;

  // Imports occur only after the private DB and local provider are configured; no .env is loaded.
  const { prisma } = await import('#infra/database/prisma.js');
  database = prisma;
  const { BUILTIN_FACTORS } = await import('#factor/definitions/builtin-factors.js');
  const factor = BUILTIN_FACTORS.find((item) => item.key === 'ep')!;
  await prisma.factor.create({
    data: {
      id: factor.key,
      userId: 'builtin',
      key: factor.key,
      name: factor.label,
      code: factor.code,
      status: 'published',
    },
  });
  await prisma.daily.createMany({
    data: ['20250301', '20250303', '20260901'].map((tradeDate) => ({
      tsCode: '000001.SZ',
      tradeDate,
      close: 10,
    })),
  });
  const sessions: Record<string, { id: string; reportIds: string[] }> = {};
  for (const locale of ['zh', 'en'] as const) {
    const userId = `question-reader-${locale}`;
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.invalid`, name: 'Research reader' },
    });
    const id = `local-question-session-${locale}`;
    await prisma.session.create({
      data: { id, userId, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const reportIds: string[] = [];
    for (const recent of [false, true]) {
      const payload = reportPayload(recent);
      const reportId = `ep-${recent ? '2023-2024' : '2020-2022'}-${locale}`;
      reportIds.push(reportId);
      await prisma.factorReport.create({
        data: {
          id: reportId,
          userId,
          factor: factor.key,
          status: 'done',
          phase: 'explore',
          freq: payload.freq,
          start: payload.start,
          end: payload.end,
          factorCodeSnapshot: factor.code,
          payload: JSON.stringify(payload),
          testKey: reportId,
          createdAt: new Date(recent ? '2026-09-12T08:00:00Z' : '2026-09-11T08:00:00Z'),
          computedAt: new Date('2026-09-12T09:00:00Z'),
        },
      });
    }
    sessions[locale] = { id, reportIds };
  }

  if (embeddedJourney) {
    await seedEmbeddedStrategies();
  }
  const { buildApp } = await import('../src/server.js');
  const app = buildApp();
  app.use('/assets/*', serveStatic({ root: webDist }));
  for (const route of ['/factors', '/strategy', '/lab', '/research']) {
    app.get(route, (context) => context.html(indexHtml));
  }
  app.use('/*', serveStatic({ root: webDist }));
  const application = await listen(app);
  applicationServer = application.server;

  process.on('message', (message: { type: string; requestId: number; locale: Locale }) => {
    if (message.type === 'stop') {
      void stop();
      return;
    }
    if (message.type === 'resume-answer') {
      const reportId = sessions[message.locale].reportIds[1];
      resumedReports.add(reportId);
      pendingAnswers.get(reportId)?.();
      return;
    }
    if (message.type === 'inspect') {
      void (async () => {
        const conversation = await prisma.agentConversation.findUnique({
          where: {
            userId_questionFactorKey: {
              userId: `question-reader-${message.locale}`,
              questionFactorKey: 'ep',
            },
          },
          include: {
            messages: { orderBy: { sequence: 'asc' } },
            turns: { orderBy: { startedAt: 'asc' } },
          },
        });
        const savedFactor = await prisma.factor.findUniqueOrThrow({ where: { id: 'ep' } });
        process.send!({
          type: 'inspection',
          requestId: message.requestId,
          conversation,
          modelRequests,
          failures,
          factorUnchanged: savedFactor.code === factor.code && savedFactor.messages === null,
        });
      })().catch((error: unknown) => {
        process.send!({ type: 'error', message: String(error) });
      });
    }
  });
  process.send!({ type: 'ready', base: application.base, modelBase: localModel.base, sessions });
} catch (error) {
  process.send!({ type: 'error', message: String(error) });
  await stop();
  process.exitCode = 1;
}

// Representative, internally consistent synthetic reports: this test reads existing results.
// It does not claim to validate the Factor evaluator or a live model's analytical judgment.
function reportPayload(recent: boolean): FactorReport {
  const icMean = recent ? 0.015 : 0.04;
  const icStd = recent ? 0.075 : 0.08;
  return {
    factor: 'ep',
    label: '盈利收益率(1/PE_TTM)',
    freq: 'month',
    neutral: 'none',
    start: recent ? '20230101' : '20200101',
    end: recent ? '20241231' : '20221231',
    periods: recent ? 24 : 36,
    icMean,
    icStd,
    icir: icMean / icStd,
    icirAnnual: (icMean / icStd) * Math.sqrt(12),
    icPosRate: recent ? 13 / 24 : 25 / 36,
    buckets: Array.from({ length: 10 }, (_, bucket) => {
      const annReturn = -0.02 + bucket * (recent ? 0.007 : 0.012);
      return {
        bucket,
        annReturn,
        sharpe: annReturn / 0.2,
        maxDrawdown: -0.2,
        navEnd: (1 + annReturn) ** (recent ? 2 : 3),
      };
    }),
    longShort: {
      annReturn: recent ? 0.06 : 0.1,
      sharpe: recent ? 0.4 : 0.7,
      maxDrawdown: -0.12,
      navEnd: (recent ? 1.06 : 1.1) ** (recent ? 2 : 3),
    },
    topTurnover: 0.25,
    icDecay: [],
  };
}
