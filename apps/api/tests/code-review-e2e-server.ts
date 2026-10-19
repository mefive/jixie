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
import { ulid } from 'ulid';

// 只使用隔离数据库和确定性生成物，浏览器通过真实 HTTP 接口审阅与接受。
// Use a disposable database and deterministic generated artifacts with real review/accept HTTP.
assert.ok(process.send);
const directory = await mkdtemp(join(tmpdir(), 'jixie-code-review-browser-'));
process.env.DATABASE_URL = `file:${join(directory, 'review.db')}`;
process.env.NODE_ENV = 'test';
process.env.DEEPSEEK_API_KEY = 'unused-code-review-fixture';
let server: Server | undefined;
let database: typeof import('#infra/database/prisma.js').prisma | undefined;
let stopping = false;

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (server) {
    const closed = new Promise<void>((resolveClosed) => server!.close(() => resolveClosed()));
    server.closeAllConnections();
    await closed;
  }
  const { researchPythonLanguageService } =
    await import('#research/language/research-python-language-service.js');
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
  await writeFile(join(directory, 'review.db'), '');

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
  const { prisma } = await import('#infra/database/prisma.js');
  database = prisma;
  const { startPersistentTurn, finishPersistentTurn } = await import('#agent/turns/records.js');
  const { factorCodeIdentity } = await import('#factor/agent/code-proposals.js');
  const { strategyCodeIdentity } = await import('#strategy/agent/code-proposals.js');
  const { BUILTIN_FACTORS } = await import('#factor/definitions/builtin-factors.js');
  const userId = 'review-owner';
  const email = 'code-review@fixture.invalid';
  await prisma.user.create({ data: { id: userId, email } });
  // 补齐页面启动依赖的研究窗口，不触发任何行情下载或计算。
  // Seed the page's research-window prerequisite without market downloads or computation.
  await prisma.daily.createMany({
    data: ['20240102', '20240702', '20260105'].map((tradeDate) => ({
      tsCode: '000001.SZ',
      tradeDate,
      close: 10,
    })),
  });

  const factorBefore = BUILTIN_FACTORS.find((factor) => factor.key === 'ep')!.code;
  const strategyBefore =
    "export default defineStrategy({ name: 'Review fixture', params: {}, onBar(ctx) {} });";
  const hosts = {
    factor: await prisma.factor.create({
      data: {
        id: ulid(),
        userId,
        key: 'review_factor',
        name: '代码审阅因子',
        code: factorBefore,
        language: 'typescript',
        runtimeVersion: 'ts-v1',
      },
    }),
    strategy: await prisma.strategy.create({
      data: {
        id: ulid(),
        userId,
        name: '代码审阅策略',
        config: {
          name: '代码审阅策略',
          code: strategyBefore,
          language: 'typescript',
          runtimeVersion: 'ts-v1',
          start: '20250101',
          end: '20251231',
          initialCash: 100000,
        },
        messages: [],
      },
    }),
  };
  const ids: Record<string, string> = {};
  for (const surface of ['factor', 'strategy'] as const) {
    const entityId = hosts[surface].id;
    const beforeCode = surface === 'factor' ? factorBefore : strategyBefore;
    const afterCode = `${beforeCode}\n// 审阅后才保存。 / Save only after review.\n`;
    const turnId = `review-${surface}-turn`;
    await startPersistentTurn({
      turnId,
      userId,
      entity: { kind: surface, id: entityId },
      history: [],
      message: '请提出代码修改，等待我确认。',
      model: 'deterministic-review-fixture',
    });
    const parts = await finishPersistentTurn({
      turnId,
      status: 'done',
      trace: { version: 1, steps: [], truncated: false },
      parts: [{ type: 'text', text: '修改建议已生成，当前代码保持不变。' }],
      codeChange: {
        surface,
        entityId,
        beforeCode,
        afterCode,
        language: 'typescript',
        baseIdentity:
          surface === 'factor'
            ? factorCodeIdentity(hosts.factor)
            : strategyCodeIdentity(hosts.strategy.config),
      },
    });
    const data = {
      messages: JSON.parse(
        JSON.stringify([
          { role: 'user', parts: [{ type: 'text', text: '请提出代码修改。' }] },
          { role: 'assistant', parts, turnId },
        ]),
      ),
    };
    if (surface === 'factor') {
      await prisma.factor.update({ where: { id: entityId }, data });
    } else {
      await prisma.strategy.update({ where: { id: entityId }, data });
    }
    ids[surface] = parts!.find((part) => part.type === 'code_change')!.proposal.id;
  }
  const documentId = '01M0A1YW42TSJ3BFAS6E5KC39Q';
  const cellId = 'review-markdown';
  await prisma.agentConversation.create({
    data: { id: documentId, userId, surface: 'research', title: '研究修改审阅' },
  });
  const document = await prisma.researchDocument.create({
    data: {
      id: documentId,
      userId,
      conversationId: documentId,
      cells: {
        create: [
          {
            id: cellId,
            position: 0,
            kind: 'markdown',
            source: '## 原始研究问题',
            definitions: [],
            references: [],
          },
        ],
      },
    },
  });
  const proposal = {
    version: 1 as const,
    id: 'review-research-proposal',
    documentId,
    title: '补充研究假设',
    summary: '明确接受后才更新研究文档。',
    status: 'pending' as const,
    expectedDocumentUpdatedAt: document.updatedAt.toISOString(),
    expectedDocumentContentRevision: document.contentRevision,
    createdAt: new Date().toISOString(),
    operations: [
      {
        operationId: 'review-operation',
        cellId,
        position: 0,
        kind: 'update' as const,
        cellKind: 'markdown' as const,
        expectedRevision: 1,
        beforeSource: '## 原始研究问题',
        afterSource: '## 原始研究问题\n\n待验证假设：收益存在持续性。',
        addedLines: 2,
        removedLines: 0,
        afterDefinitions: [],
        afterReferences: [],
      },
    ],
  };
  await startPersistentTurn({
    turnId: 'review-research-turn',
    userId,
    entity: { kind: 'research', id: documentId },
    history: [],
    message: '请补充假设。',
    model: 'deterministic-review-fixture',
  });
  await finishPersistentTurn({
    turnId: 'review-research-turn',
    status: 'done',
    trace: { version: 1, steps: [], truncated: false },
    parts: [{ type: 'research_cell_change', proposal }],
  });
  const { buildApp } = await import('../src/server.js');
  const application = buildApp();
  const app = new Hono();
  const webDist = resolve('../web/dist');
  const index = await readFile(join(webDist, 'index.html'), 'utf8');
  app.all('/api/*', (context) => application.fetch(context.req.raw));
  app.use('/*', serveStatic({ root: webDist }));
  app.get('*', (context) => context.html(index));
  const base = await new Promise<string>((resolveBase) => {
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (address) =>
      resolveBase(`http://127.0.0.1:${address.port}`),
    ) as Server;
  });
  process.send!({
    type: 'ready',
    base,
    email,
    ids,
    entityIds: { factor: hosts.factor.id, strategy: hosts.strategy.id },
    documentId,
    cellId,
    researchProposalId: proposal.id,
  });
} catch (error) {
  process.send!({ type: 'error', message: String(error) });
  await stop();
}
