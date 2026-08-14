import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import prismaPackage from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tushareCapabilityProbesAreFresh } from '../tushare/capability-probe-store.js';
import {
  executeResearchCuratorRun,
  extractResearchCuratorEvidence,
  getResearchCuratorRun,
  researchCuratorQuality,
  setResearchCuratorFindingDisposition,
  updateResearchCuratorFindingFeedback,
} from './curator.js';

const { PrismaClient: RuntimePrismaClient } = prismaPackage;

describe('research curator', () => {
  let temporaryDirectory: string;
  let database: PrismaClient;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-research-curator-'));
    database = new RuntimePrismaClient({
      datasourceUrl: `file:${join(temporaryDirectory, 'curator.db')}`,
    });
    await createFixtureSchema(database);
    await seedUserConversation(database, 'user-a', 'a@example.com', 'conversation-a');
    await seedUserConversation(database, 'user-b', 'b@example.com', 'conversation-b');
    await database.agentMessage.createMany({
      data: [
        {
          id: 'message-a',
          conversationId: 'conversation-a',
          role: 'user',
          parts: [{ type: 'text', text: 'market.adjusted_close 的月度回归能否做成固定研究协议？' }],
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
            category: 'protocol_candidate',
            title: 'Register a monthly adjusted-close relationship protocol',
            summary: 'The user repeatedly needs market.adjusted_close regression research.',
            evidenceIds: ['message:message-a'],
            confidence: 0.9,
            expectedValue: 'Make a repeated research workflow deterministic.',
            changeSurface: ['research catalog', 'protocol registry'],
            suggestedAction: 'Review a registered monthly relationship protocol.',
          },
        ],
      }),
    );

    const run = await executeResearchCuratorRun('run-a', { database, llm });
    expect(llm).toHaveBeenCalledOnce();
    expect(run).toMatchObject({ status: 'done', evidenceCount: 1, findingsCreated: 1 });
    expect(run.findings[0]).toMatchObject({
      category: 'protocol_candidate',
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
      await executeResearchCuratorRun(runId, { database, llm: async () => response });
    }
    const repeated = await getResearchCuratorRun('user-a', 'run-b', database);
    expect(repeated).toMatchObject({ findingsCreated: 0, duplicatesSkipped: 1, findings: [] });
    const finding = await database.researchCuratorFinding.findFirstOrThrow();
    await expect(
      setResearchCuratorFindingDisposition('user-b', finding.id, 'accepted', undefined, database),
    ).resolves.toBeNull();
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

    const run = await executeResearchCuratorRun('run-supplier', {
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
    const run = await executeResearchCuratorRun('run-probed-supplier', {
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

    const run = await executeResearchCuratorRun('run-large-window', { database, llm });

    expect(run.evidenceCount).toBe(502);
    expect(llm).toHaveBeenCalledTimes(7);
  });
});

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

async function createFixtureSchema(database: PrismaClient) {
  const statements = [
    'PRAGMA foreign_keys=ON',
    'CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "name" TEXT, "status" TEXT NOT NULL DEFAULT \'active\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE "AgentConversation" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "surface" TEXT NOT NULL, "title" TEXT, "strategyId" TEXT, "factorId" TEXT, "archivedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)',
    'CREATE TABLE "AgentMessage" ("id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "role" TEXT NOT NULL, "parts" JSONB NOT NULL, "sequence" INTEGER NOT NULL, "turnId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "AgentTurn" ("id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "status" TEXT NOT NULL, "model" TEXT NOT NULL, "trace" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" DATETIME, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchRun" ("id" TEXT NOT NULL PRIMARY KEY)',
    'CREATE TABLE "ResearchStudy" ("id" TEXT NOT NULL PRIMARY KEY)',
    'CREATE TABLE "ResearchAttempt" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "studyId" TEXT, "parentRunId" TEXT, "sourceTurnId" TEXT, "sourceStepId" TEXT, "origin" TEXT NOT NULL, "plan" JSONB, "planHash" TEXT, "arguments" TEXT NOT NULL, "error" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchCuratorRun" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT \'queued\', "trigger" TEXT NOT NULL DEFAULT \'manual\', "cursorFrom" DATETIME, "cursorTo" DATETIME NOT NULL, "evidenceCount" INTEGER NOT NULL DEFAULT 0, "findingsCreated" INTEGER NOT NULL DEFAULT 0, "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)',
    'CREATE TABLE "ResearchCuratorFinding" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "runId" TEXT NOT NULL, "category" TEXT NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "evidence" JSONB NOT NULL, "verification" JSONB NOT NULL, "confidence" REAL NOT NULL, "expectedValue" TEXT NOT NULL, "changeSurface" JSONB NOT NULL, "suggestedAction" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "disposition" TEXT NOT NULL DEFAULT \'pending\', "dispositionNote" TEXT, "disposedAt" DATETIME, "verificationAssessment" TEXT, "verificationAssessedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("runId") REFERENCES "ResearchCuratorRun"("id") ON DELETE CASCADE)',
    'CREATE TABLE "TushareCapabilityProbe" ("id" TEXT NOT NULL PRIMARY KEY, "catalogVersion" INTEGER NOT NULL, "apiName" TEXT NOT NULL, "domain" TEXT NOT NULL, "probeDate" TEXT NOT NULL, "status" TEXT NOT NULL, "rowCount" INTEGER NOT NULL, "fields" JSONB NOT NULL, "historyField" TEXT, "historyStart" TEXT, "historyEnd" TEXT, "probeCoverage" TEXT, "errorCode" INTEGER, "errorMessage" TEXT, "probedAt" DATETIME NOT NULL)',
    'CREATE TABLE "Job" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "kind" TEXT NOT NULL, "key" TEXT NOT NULL, "status" TEXT NOT NULL, "payload" JSONB, "error" TEXT, "logs" TEXT, "factorReportId" TEXT, "strategyScanReportId" TEXT, "signalRunId" TEXT, "researchCuratorRunId" TEXT, "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" DATETIME, "finishedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE, FOREIGN KEY ("researchCuratorRunId") REFERENCES "ResearchCuratorRun"("id") ON DELETE CASCADE)',
    'CREATE UNIQUE INDEX "User_email_key" ON "User"("email")',
    'CREATE UNIQUE INDEX "ResearchCuratorFinding_userId_fingerprint_key" ON "ResearchCuratorFinding"("userId", "fingerprint")',
    'CREATE UNIQUE INDEX "Job_researchCuratorRunId_key" ON "Job"("researchCuratorRunId")',
  ];
  for (const statement of statements) {
    await database.$executeRawUnsafe(statement);
  }
}
