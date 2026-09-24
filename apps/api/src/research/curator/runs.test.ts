import { tushareCapabilityProbesAreFresh } from '#market/providers/tushare/capability-probe-store.js';
import type { PrismaClient } from '@prisma/client';
import prismaPackage from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setResearchCuratorFindingDisposition,
  updateResearchCuratorFindingFeedback,
} from './feedback.js';
import { extractResearchCuratorEvidence } from './prepare.js';
import { getResearchCuratorRun, researchCuratorQuality } from './read.js';

import { JobService, type Job } from '#jobs/service.js';
import { researchCuratorLifecycle } from './research-curator-lifecycle.js';
import * as curator from './prepare.js';
import * as referenceSearch from './reference-search.js';

const fixtureDatabase = vi.hoisted(() => ({ current: null as PrismaClient | null }));
vi.mock('#infra/database/prisma.js', () => ({
  get prisma() {
    return fixtureDatabase.current;
  },
}));

const originalPrepare = curator.prepareResearchCuratorRun;
const { PrismaClient: RuntimePrismaClient } = prismaPackage;

describe('research curator', () => {
  let temporaryDirectory: string;
  let database: PrismaClient;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-research-curator-'));
    const databasePath = join(temporaryDirectory, 'curator.db');
    await writeFile(databasePath, '');
    const databaseUrl = `file:${databasePath}`;
    database = new RuntimePrismaClient({ datasourceUrl: databaseUrl });
    fixtureDatabase.current = database;
    createFixtureSchema(databaseUrl);
    await seedUserConversation(database, 'user-a', 'a@example.com', 'conversation-a');
    await seedUserConversation(database, 'user-b', 'b@example.com', 'conversation-b');
    await database.agentMessage.createMany({
      data: [
        {
          id: 'message-a',
          conversationId: 'conversation-a',
          role: 'user',
          parts: [{ type: 'text', text: 'market.adjusted_close 的月度回归能否做成研究方法模板？' }],
          sequence: 0,
          createdAt: new Date('2026-08-14T01:00:00.000Z'),
        },
        {
          id: 'message-b',
          conversationId: 'conversation-b',
          role: 'user',
          parts: [{ type: 'text', text: 'Tushare cn_cpi 数据应该落到本地库。' }],
          sequence: 0,
          createdAt: new Date('2026-08-14T01:00:00.000Z'),
        },
      ],
    });
  });

  afterEach(async () => {
    await database.$disconnect();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('excludes internal embedded conversations while retaining ordinary legacy conversations', async () => {
    await database.agentConversation.create({
      data: { id: 'embedded', userId: 'user-a', surface: 'research', title: 'Internal analysis' },
    });
    await database.researchDocument.create({
      data: { id: 'embedded', userId: 'user-a', conversationId: 'embedded' },
    });
    await database.researchEmbeddedAnalysis.create({
      data: {
        id: 'analysis',
        userId: 'user-a',
        hostType: 'factor',
        hostId: 'fixture',
        title: 'Analysis',
        versions: {
          create: {
            id: 'version',
            number: 1,
            documentId: 'embedded',
            source: '42',
            parameters: {},
            inputScope: 'Fixture',
            contextSnapshot: {},
          },
        },
      },
    });
    await database.agentMessage.create({
      data: {
        id: 'embedded-message',
        conversationId: 'embedded',
        role: 'user',
        sequence: 0,
        parts: [{ type: 'text', text: 'market.adjusted_close regression method template' }],
        createdAt: new Date('2026-08-14T01:00:00.000Z'),
      },
    });

    const evidence = await extractResearchCuratorEvidence(
      'user-a',
      null,
      new Date('2026-08-14T02:00:00.000Z'),
      database,
    );
    expect(evidence.map((entry) => entry.conversationId)).toEqual(['conversation-a']);
  });

  it('extracts only the current user evidence and verifies model drafts deterministically', async () => {
    const cursorTo = new Date('2026-08-14T02:00:00.000Z');
    await database.researchCuratorRun.create({
      data: { id: 'run-a', userId: 'user-a', cursorTo },
    });
    const evidence = await extractResearchCuratorEvidence('user-a', null, cursorTo, database);
    expect(evidence).toEqual([
      expect.objectContaining({
        id: 'message:message-a',
        conversationId: 'conversation-a',
        signals: expect.arrayContaining(['method']),
      }),
    ]);
    const llm = vi.fn(async () =>
      JSON.stringify({
        findings: [
          {
            category: 'method_candidate',
            title: 'Add a monthly adjusted-close relationship method template',
            summary: 'The user repeatedly needs market.adjusted_close regression research.',
            evidenceIds: ['message:message-a'],
            confidence: 0.9,
            expectedValue: 'Make a repeated research workflow deterministic.',
            changeSurface: ['research workbench', 'method templates'],
            suggestedAction: 'Review a transparent Markdown and Python method template.',
          },
        ],
      }),
    );

    const run = await prepareAndCompleteCuratorRun('run-a', { database, llm });
    expect(llm).toHaveBeenCalledOnce();
    expect(run).toMatchObject({ status: 'done', evidenceCount: 1, findingsCreated: 1 });
    expect(run.findings[0]).toMatchObject({
      category: 'method_candidate',
      disposition: 'pending',
      verification: {
        status: 'verified',
        matches: expect.arrayContaining([
          { kind: 'research_measure', id: 'market.adjusted_close' },
        ]),
        evidence: expect.arrayContaining([
          expect.objectContaining({
            kind: 'catalog',
            reference: 'research-measure:market.adjusted_close',
          }),
        ]),
      },
    });
  });

  it('suppresses repeated findings and scopes human disposition by owner', async () => {
    const cursorTo = new Date('2026-08-14T02:00:00.000Z');
    const response = JSON.stringify({
      findings: [
        {
          category: 'documentation_gap',
          title: 'Explain adjusted close',
          summary: 'The concept needs a clearer explanation.',
          evidenceIds: ['message:message-a'],
          confidence: 0.8,
          expectedValue: 'Reduce repeated questions.',
          changeSurface: ['help center'],
          suggestedAction: 'Review a concept article.',
        },
      ],
    });
    for (const runId of ['run-a', 'run-b']) {
      await database.researchCuratorRun.create({ data: { id: runId, userId: 'user-a', cursorTo } });
      await prepareAndCompleteCuratorRun(runId, { database, llm: async () => response });
    }
    const repeated = await getResearchCuratorRun('user-a', 'run-b', database);
    expect(repeated).toMatchObject({ findingsCreated: 0, duplicatesSkipped: 1, findings: [] });
    const finding = await database.researchCuratorFinding.findFirstOrThrow();
    await expect(
      setResearchCuratorFindingDisposition('user-b', finding.id, 'accepted', undefined, database),
    ).rejects.toMatchObject({ reason: 'curator_finding_not_found' });
    await expect(
      setResearchCuratorFindingDisposition(
        'user-a',
        finding.id,
        'accepted',
        'Add to the normal planning flow.',
        database,
      ),
    ).resolves.toMatchObject({ disposition: 'accepted' });
  });

  it('treats a Tushare catalog match as partial until a live capability check is run', async () => {
    const cursorTo = new Date('2026-08-14T02:00:00.000Z');
    await database.researchCuratorRun.create({
      data: { id: 'run-supplier', userId: 'user-b', cursorTo },
    });
    const response = JSON.stringify({
      findings: [
        {
          category: 'supplier_data_gap',
          title: 'Check Tushare cn_cpi availability',
          summary: 'The requested cn_cpi series may need to be synchronized locally.',
          evidenceIds: ['message:message-b'],
          confidence: 0.85,
          expectedValue: 'Support inflation research without ad-hoc searches.',
          changeSurface: ['data capability catalog'],
          suggestedAction:
            'Run a read-only permission and field smoke check before planning ingestion.',
        },
      ],
    });

    const run = await prepareAndCompleteCuratorRun('run-supplier', {
      database,
      llm: async () => response,
    });

    expect(run.findings[0]).toMatchObject({
      verification: {
        status: 'partial',
        matches: expect.arrayContaining([{ kind: 'tushare_api', id: 'cn_cpi' }]),
      },
    });
  });

  it('verifies planned cross-market contracts without claiming the candidate source is integrated', async () => {
    const cursorTo = new Date('2026-08-14T02:00:00.000Z');
    await database.agentMessage.create({
      data: {
        id: 'message-us-source',
        conversationId: 'conversation-b',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: '请评估 us.equity.adjusted_close.daily 与 tushare.us_equity。',
          },
        ],
        sequence: 1,
        createdAt: new Date('2026-08-14T01:30:00.000Z'),
      },
    });
    await database.researchCuratorRun.create({
      data: { id: 'run-us-source', userId: 'user-b', cursorTo },
    });
    const run = await prepareAndCompleteCuratorRun('run-us-source', {
      database,
      llm: async () =>
        JSON.stringify({
          findings: [
            {
              category: 'supplier_data_gap',
              title: 'Review the Tushare US equity candidate',
              summary: 'US equity research needs us_daily_adj and an audited local contract.',
              evidenceIds: ['message:message-us-source'],
              confidence: 0.85,
              expectedValue: 'Avoid treating a documented API as integrated local data.',
              changeSurface: ['cross-market data'],
              suggestedAction: 'Run the registered permission and coverage checks.',
            },
          ],
        }),
    });

    expect(run.findings[0]).toMatchObject({
      verification: {
        status: 'verified',
        matches: expect.arrayContaining([
          { kind: 'data_contract', id: 'us.equity.adjusted_close.daily' },
          { kind: 'data_source_decision', id: 'tushare.us_equity' },
        ]),
        notes: expect.arrayContaining(['cross_market_contract_match', 'source_decision_match']),
        evidence: expect.arrayContaining([
          expect.objectContaining({
            stance: 'limits',
            reference: 'source-decision:v1:tushare.us_equity',
          }),
        ]),
      },
    });
  });

  it('uses the latest persisted supplier probe and records independent verification feedback', async () => {
    await database.tushareCapabilityProbe.create({
      data: {
        id: 'probe-cpi',
        catalogVersion: 1,
        apiName: 'cn_cpi',
        domain: 'macro',
        probeDate: '20260807',
        status: 'ok',
        rowCount: 511,
        fields: ['month', 'nt_yoy'],
        historyField: 'month',
        historyStart: '195112',
        historyEnd: '202607',
        probeCoverage: 'full_response',
        probedAt: new Date('2026-08-14T02:00:00.000Z'),
      },
    });
    await expect(
      tushareCapabilityProbesAreFresh(
        ['cn_cpi'],
        7,
        new Date('2026-08-14T03:00:00.000Z'),
        database,
      ),
    ).resolves.toBe(true);
    await expect(
      tushareCapabilityProbesAreFresh(
        ['cn_cpi', 'shibor'],
        7,
        new Date('2026-08-14T03:00:00.000Z'),
        database,
      ),
    ).resolves.toBe(false);
    await database.researchCuratorRun.create({
      data: {
        id: 'run-probed-supplier',
        userId: 'user-b',
        cursorTo: new Date('2026-08-14T03:00:00.000Z'),
      },
    });
    const run = await prepareAndCompleteCuratorRun('run-probed-supplier', {
      database,
      llm: async () =>
        JSON.stringify({
          findings: [
            {
              category: 'supplier_data_gap',
              title: 'Synchronize Tushare cn_cpi',
              summary: 'cn_cpi is requested for local inflation research.',
              evidenceIds: ['message:message-b'],
              confidence: 0.9,
              expectedValue: 'Make CPI research reproducible.',
              changeSurface: ['macro data'],
              suggestedAction: 'Review a bounded cn_cpi ingestion plan.',
            },
          ],
        }),
    });
    expect(run.findings[0]).toMatchObject({
      verification: {
        status: 'verified',
        notes: expect.arrayContaining(['tushare_probe_available']),
        evidence: expect.arrayContaining([
          expect.objectContaining({ kind: 'probe', stance: 'supports' }),
        ]),
      },
    });

    const assessed = await updateResearchCuratorFindingFeedback(
      'user-b',
      run.findings[0]!.id,
      { verificationAssessment: 'incorrect' },
      database,
    );
    expect(assessed).toMatchObject({ verificationAssessment: 'incorrect' });
    await updateResearchCuratorFindingFeedback(
      'user-b',
      run.findings[0]!.id,
      { disposition: 'accepted', note: 'Plan this.' },
      database,
    );
    await expect(researchCuratorQuality('user-b', database)).resolves.toMatchObject({
      reviewed: 1,
      accepted: 1,
      acceptanceRate: 1,
      verificationAssessments: 1,
      verificationErrors: 1,
      verificationErrorRate: 1,
      evaluationReady: false,
    });
  });

  it('publishes no partial findings if preparing a later candidate fails', async () => {
    await database.researchCuratorRun.create({
      data: {
        id: 'run-prepare-failure',
        job: {
          create: {
            id: 'prepare-attempt',
            userId: 'user-a',
            kind: 'research-curator',
            key: 'prepare',
            status: 'running',
          },
        },
        userId: 'user-a',
        cursorTo: new Date('2026-08-14T02:00:00.000Z'),
      },
    });
    const findings = ['first', 'second'].map((name) => ({
      category: 'documentation_gap',
      title: `Explain adjusted close ${name}`,
      summary: 'Explain this concept.',
      evidenceIds: ['message:message-a'],
      confidence: 0.8,
      expectedValue: 'Clarify research.',
      changeSurface: ['help'],
      suggestedAction: `Review ${name}.`,
    }));
    const search = vi
      .spyOn(referenceSearch, 'searchCuratorRepositoryReferences')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('reference search failed'));
    try {
      await expect(
        originalPrepare('run-prepare-failure', {
          database,
          llm: async () => JSON.stringify({ findings }),
        }),
      ).rejects.toThrow('reference search failed');
      expect(search).toHaveBeenCalledTimes(2);
      expect(await database.researchCuratorFinding.count()).toBe(0);
      expect(
        await database.researchCuratorRun.findUnique({ where: { id: 'run-prepare-failure' } }),
      ).toMatchObject({ legacyStatus: null, findingsCreated: 0 });
    } finally {
      search.mockRestore();
    }
  });

  it('does not truncate large evidence windows and summarizes them in bounded chunks', async () => {
    await database.agentMessage.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        id: `bulk-message-${index}`,
        conversationId: 'conversation-a',
        role: 'user',
        parts: [{ type: 'text', text: `统计回归研究需求 ${index}` }],
        sequence: index + 1,
        createdAt: new Date(Date.parse('2026-08-14T01:10:00.000Z') + index),
      })),
    });
    const cursorTo = new Date('2026-08-14T02:00:00.000Z');
    await database.researchCuratorRun.create({
      data: { id: 'run-large-window', userId: 'user-a', cursorTo },
    });
    const llm = vi.fn(async () => JSON.stringify({ findings: [] }));

    const run = await prepareAndCompleteCuratorRun('run-large-window', { database, llm });

    expect(run.evidenceCount).toBe(502);
    expect(llm).toHaveBeenCalledTimes(7);
  });
});

// Domain tests execute the registered lifecycle through the service and fixture database.
async function prepareAndCompleteCuratorRun(
  runId: string,
  options: {
    database: PrismaClient;
    llm: NonNullable<Parameters<typeof originalPrepare>[1]>['llm'];
  },
) {
  const run = await options.database.researchCuratorRun.findUniqueOrThrow({ where: { id: runId } });
  const prepare = vi
    .spyOn(curator, 'prepareResearchCuratorRun')
    .mockImplementation((id) => originalPrepare(id, options));
  try {
    const job = {
      id: `job-${runId}`,
      userId: run.userId,
      researchCuratorRunId: runId,
      payload: { runId },
      kind: 'research-curator',
      key: runId,
      status: 'running',
      error: null,
      logs: null,
      factorReportId: null,
      researchExecutionId: null,
      backtestReportId: null,
      strategyScanReportId: null,
      signalRunId: null,
      queuedAt: new Date(0),
      startedAt: new Date(0),
      finishedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } satisfies Job;
    await options.database.job.create({ data: { ...job, payload: { runId } } });
    JobService.register('research-curator', researchCuratorLifecycle);
    await JobService.execute(job.id);
    return (await getResearchCuratorRun(run.userId, runId, options.database))!;
  } finally {
    prepare.mockRestore();
  }
}

async function seedUserConversation(
  database: PrismaClient,
  userId: string,
  email: string,
  conversationId: string,
) {
  await database.user.create({ data: { id: userId, email } });
  await database.agentConversation.create({
    data: { id: conversationId, userId, surface: 'research', title: 'Research' },
  });
}

function createFixtureSchema(databaseUrl: string) {
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'db',
      'push',
      '--skip-generate',
      '--schema',
      resolve('prisma/schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
  );
}
