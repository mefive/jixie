import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AgentTurnTrace,
  MessagePart,
  ResearchCuratorDispositionV1,
  ResearchCuratorEvidenceV1,
  ResearchCuratorFindingCategoryV1,
  ResearchCuratorFindingV1,
  ResearchCuratorRunV1,
  ResearchCuratorVerificationMatchV1,
} from '@jixie/shared';
import { z } from 'zod';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { chatJson, type LlmCall } from '../llm/deepseek.js';
import { SQL_TABLE_DOCS } from '../agent/tools/read-only-sql.js';
import { ASSET_ALLOCATION_PROBES } from '../tushare/asset-allocation-probe.js';
import { researchCapabilityCatalog } from './catalog.js';
import { researchPayloadHash } from './fingerprints.js';

const findingCategorySchema = z.enum([
  'protocol_candidate',
  'supplier_data_gap',
  'local_capability_gap',
  'documentation_gap',
  'tool_or_interaction_defect',
  'no_action',
]);

const curatorDraftSchema = z.strictObject({
  category: findingCategorySchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(800),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  confidence: z.number().min(0).max(1),
  expectedValue: z.string().trim().min(1).max(400),
  changeSurface: z.array(z.string().trim().min(1).max(80)).max(12),
  suggestedAction: z.string().trim().min(1).max(500),
});

const curatorResponseSchema = z.strictObject({
  findings: z.array(curatorDraftSchema).max(20),
});

export const curatorDispositionSchema = z.strictObject({
  disposition: z.enum(['accepted', 'rejected', 'deferred', 'duplicate']),
  note: z.string().trim().max(500).optional(),
});

const SIGNAL_PATTERNS: Array<[string, RegExp]> = [
  ['supplier', /\b(?:tushare|wind|choice|api|接口|供应商)\b/i],
  ['data_gap', /(?:没有数据|缺少数据|查不到|字段|落库|本地库|数据源|宏观|利率|汇率|库存|持仓)/i],
  ['method', /(?:相关|回归|分布|统计|检验|事件研究|滚动|季节性|状态切换|图表|可视化)/i],
  ['documentation', /(?:什么意思|怎么理解|解释|公式|文档|概念|教程|why|explain|documentation)/i],
  ['correction', /(?:不对|不是|应该|纠正|改成|actually|instead|wrong)/i],
];

const CURATOR_EVIDENCE_CHUNK_SIZE = 80;

type CuratorRunWithRelations = Prisma.ResearchCuratorRunGetPayload<{
  include: { job: { select: { id: true } }; findings: true };
}>;

type CuratorFindingRecord = Prisma.ResearchCuratorFindingGetPayload<object>;

export async function extractResearchCuratorEvidence(
  userId: string,
  cursorFrom: Date | null,
  cursorTo: Date,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorEvidenceV1[]> {
  const after = cursorFrom ? { gt: cursorFrom } : undefined;
  const [messages, turns, attempts] = await Promise.all([
    database.agentMessage.findMany({
      where: {
        role: 'user',
        createdAt: { ...(after ?? {}), lte: cursorTo },
        conversation: { userId, surface: 'research' },
      },
      select: { id: true, conversationId: true, parts: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    database.agentTurn.findMany({
      where: {
        startedAt: { ...(after ?? {}), lte: cursorTo },
        conversation: { userId, surface: 'research' },
      },
      select: { id: true, conversationId: true, trace: true, startedAt: true },
      orderBy: { startedAt: 'asc' },
    }),
    database.researchAttempt.findMany({
      where: { userId, createdAt: { ...(after ?? {}), lte: cursorTo } },
      select: {
        id: true,
        conversationId: true,
        sourceStepId: true,
        error: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const normalizedStepIds = new Set(
    attempts.map((attempt) => attempt.sourceStepId).filter((id): id is string => Boolean(id)),
  );
  const evidence: ResearchCuratorEvidenceV1[] = [];

  for (const message of messages) {
    const excerpt = textFromParts(message.parts).slice(0, 800);
    const signals = detectSignals(excerpt);
    if (!excerpt || signals.length === 0) {
      continue;
    }
    evidence.push({
      id: `message:${message.id}`,
      sourceType: 'message',
      sourceId: message.id,
      conversationId: message.conversationId,
      occurredAt: message.createdAt.toISOString(),
      excerpt,
      signals,
    });
  }
  for (const turn of turns) {
    const trace = turn.trace as unknown as AgentTurnTrace;
    const steps = Array.isArray(trace.steps) ? trace.steps : [];
    for (const step of steps) {
      if (step.type !== 'tool' || step.ok || normalizedStepIds.has(step.id)) {
        continue;
      }
      evidence.push({
        id: `tool:${step.id}`,
        sourceType: 'tool_failure',
        sourceId: step.id,
        conversationId: turn.conversationId,
        occurredAt: step.createdAt || turn.startedAt.toISOString(),
        excerpt: `${step.name}: ${step.observation}`.slice(0, 800),
        signals: ['tool_failure', step.name],
      });
    }
  }
  for (const attempt of attempts) {
    evidence.push({
      id: `attempt:${attempt.id}`,
      sourceType: 'research_attempt',
      sourceId: attempt.id,
      conversationId: attempt.conversationId,
      occurredAt: attempt.createdAt.toISOString(),
      excerpt: attempt.error.slice(0, 800),
      signals: ['research_failure'],
    });
  }
  return evidence.sort((left, right) => {
    const byTime = left.occurredAt.localeCompare(right.occurredAt);
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  });
}

export async function executeResearchCuratorRun(
  runId: string,
  options: { database?: PrismaClient; llm?: LlmCall } = {},
): Promise<ResearchCuratorRunV1> {
  const database = options.database ?? prisma;
  const llm = options.llm ?? chatJson;
  const run = await database.researchCuratorRun.findUniqueOrThrow({ where: { id: runId } });
  await database.researchCuratorRun.update({
    where: { id: run.id },
    data: { status: 'running', error: null },
  });
  const evidence = await extractResearchCuratorEvidence(
    run.userId,
    run.cursorFrom,
    run.cursorTo,
    database,
  );
  const drafts = evidence.length > 0 ? await summarizeEvidence(evidence, llm) : [];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  let findingsCreated = 0;
  let duplicatesSkipped = 0;

  for (const draft of drafts) {
    const cited = draft.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is ResearchCuratorEvidenceV1 => Boolean(item));
    if (cited.length === 0 || draft.category === 'no_action') {
      continue;
    }
    const verification = verifyDraft(draft.category, draft.title, draft.summary, cited);
    const fingerprint = findingFingerprint(draft.category, draft.title, draft.suggestedAction);
    const existing = await database.researchCuratorFinding.findUnique({
      where: { userId_fingerprint: { userId: run.userId, fingerprint } },
      select: { id: true },
    });
    if (existing) {
      duplicatesSkipped++;
      continue;
    }
    await database.researchCuratorFinding.create({
      data: {
        id: ulid(),
        userId: run.userId,
        runId: run.id,
        category: draft.category,
        title: draft.title,
        summary: draft.summary,
        evidence: cited as unknown as Prisma.InputJsonValue,
        verification: verification as unknown as Prisma.InputJsonValue,
        confidence: draft.confidence,
        expectedValue: draft.expectedValue,
        changeSurface: draft.changeSurface,
        suggestedAction: draft.suggestedAction,
        fingerprint,
      },
    });
    findingsCreated++;
  }
  await database.researchCuratorRun.update({
    where: { id: run.id },
    data: {
      status: 'done',
      evidenceCount: evidence.length,
      findingsCreated,
      duplicatesSkipped,
    },
  });
  return (await getResearchCuratorRun(run.userId, run.id, database))!;
}

export async function getLatestResearchCuratorRun(
  userId: string,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorRunV1 | null> {
  const run = await database.researchCuratorRun.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { job: { select: { id: true } }, findings: { orderBy: { createdAt: 'asc' } } },
  });
  return run ? curatorRunRecord(run) : null;
}

export async function getResearchCuratorRun(
  userId: string,
  runId: string,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorRunV1 | null> {
  const run = await database.researchCuratorRun.findFirst({
    where: { id: runId, userId },
    include: { job: { select: { id: true } }, findings: { orderBy: { createdAt: 'asc' } } },
  });
  return run ? curatorRunRecord(run) : null;
}

export async function setResearchCuratorFindingDisposition(
  userId: string,
  findingId: string,
  disposition: ResearchCuratorDispositionV1,
  note: string | undefined,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorFindingV1 | null> {
  const existing = await database.researchCuratorFinding.findFirst({
    where: { id: findingId, userId },
    select: { id: true },
  });
  if (!existing || disposition === 'pending') {
    return null;
  }
  const finding = await database.researchCuratorFinding.update({
    where: { id: findingId },
    data: {
      disposition,
      dispositionNote: note || null,
      disposedAt: new Date(),
    },
  });
  return curatorFindingRecord(finding);
}

async function summarizeEvidence(evidence: ResearchCuratorEvidenceV1[], llm: LlmCall) {
  const drafts: z.infer<typeof curatorDraftSchema>[] = [];
  for (let offset = 0; offset < evidence.length; offset += CURATOR_EVIDENCE_CHUNK_SIZE) {
    drafts.push(
      ...(await summarizeEvidenceChunk(
        evidence.slice(offset, offset + CURATOR_EVIDENCE_CHUNK_SIZE),
        llm,
      )),
    );
  }
  return drafts;
}

async function summarizeEvidenceChunk(evidence: ResearchCuratorEvidenceV1[], llm: LlmCall) {
  const content = await llm([
    {
      role: 'system',
      content:
        'You are a research-product curator. Group only the supplied evidence into concise candidate findings. Write each title, summary, expectedValue, changeSurface, and suggestedAction in the dominant language of its cited evidence. Never invent a data source, API, local table, feature, frequency, or user intent. A finding must cite evidenceIds exactly. Prefer no finding over weak speculation. Return JSON only with {"findings": [...]}. Categories: protocol_candidate, supplier_data_gap, local_capability_gap, documentation_gap, tool_or_interaction_defect, no_action.',
    },
    { role: 'user', content: JSON.stringify({ evidence }) },
  ]);
  return curatorResponseSchema.parse(JSON.parse(content)).findings;
}

function verifyDraft(
  category: ResearchCuratorFindingCategoryV1,
  title: string,
  summary: string,
  evidence: ResearchCuratorEvidenceV1[],
) {
  const haystack =
    `${title}\n${summary}\n${evidence.map((item) => item.excerpt).join('\n')}`.toLowerCase();
  const matches: ResearchCuratorVerificationMatchV1[] = [];
  for (const measure of [
    ...researchCapabilityCatalog.measures,
    ...researchCapabilityCatalog.universeMeasures,
  ]) {
    if (
      haystack.includes(measure.id.toLowerCase()) ||
      haystack.includes(measure.nameZh.toLowerCase()) ||
      haystack.includes(measure.nameEn.toLowerCase())
    ) {
      matches.push({ kind: 'research_measure', id: measure.id });
    }
  }
  for (const protocol of researchCapabilityCatalog.protocols) {
    if (
      haystack.includes(protocol.id.toLowerCase()) ||
      haystack.includes(protocol.nameZh.toLowerCase()) ||
      haystack.includes(protocol.nameEn.toLowerCase())
    ) {
      matches.push({ kind: 'research_protocol', id: protocol.id });
    }
  }
  for (const tableName of Object.keys(SQL_TABLE_DOCS)) {
    if (haystack.includes(tableName.toLowerCase())) {
      matches.push({ kind: 'local_data_table', id: tableName });
    }
  }
  for (const api of ASSET_ALLOCATION_PROBES) {
    if (haystack.includes(api.apiName.toLowerCase())) {
      matches.push({ kind: 'tushare_api', id: api.apiName });
    }
  }
  const unique = [
    ...new Map(matches.map((match) => [`${match.kind}:${match.id}`, match])).values(),
  ];
  const locallyVerified = unique.some((match) => match.kind !== 'tushare_api');
  const supplierCatalogMatch = unique.some((match) => match.kind === 'tushare_api');
  const status = locallyVerified ? 'verified' : supplierCatalogMatch ? 'partial' : 'unverified';
  return {
    status,
    matches: unique,
    notes: locallyVerified
      ? (['local_capability_match'] as const)
      : supplierCatalogMatch
        ? (['tushare_catalog_match_requires_smoke_check'] as const)
        : [
            category === 'supplier_data_gap'
              ? ('tushare_api_unverified' as const)
              : ('local_capability_unverified' as const),
          ],
  };
}

function curatorRunRecord(run: CuratorRunWithRelations): ResearchCuratorRunV1 {
  return {
    version: 1,
    id: run.id,
    ...(run.job?.id ? { jobId: run.job.id } : {}),
    status: run.status as ResearchCuratorRunV1['status'],
    trigger: run.trigger as ResearchCuratorRunV1['trigger'],
    ...(run.cursorFrom ? { cursorFrom: run.cursorFrom.toISOString() } : {}),
    cursorTo: run.cursorTo.toISOString(),
    evidenceCount: run.evidenceCount,
    findingsCreated: run.findingsCreated,
    duplicatesSkipped: run.duplicatesSkipped,
    ...(run.error ? { error: run.error } : {}),
    findings: run.findings.map(curatorFindingRecord),
    createdAt: run.createdAt.toISOString(),
  };
}

function curatorFindingRecord(finding: CuratorFindingRecord): ResearchCuratorFindingV1 {
  return {
    version: 1,
    id: finding.id,
    runId: finding.runId,
    category: finding.category as ResearchCuratorFindingV1['category'],
    title: finding.title,
    summary: finding.summary,
    evidence: finding.evidence as unknown as ResearchCuratorFindingV1['evidence'],
    verification: finding.verification as unknown as ResearchCuratorFindingV1['verification'],
    confidence: finding.confidence,
    expectedValue: finding.expectedValue,
    changeSurface: finding.changeSurface as unknown as ResearchCuratorFindingV1['changeSurface'],
    suggestedAction: finding.suggestedAction,
    fingerprint: finding.fingerprint,
    disposition: finding.disposition as ResearchCuratorFindingV1['disposition'],
    ...(finding.dispositionNote ? { dispositionNote: finding.dispositionNote } : {}),
    ...(finding.disposedAt ? { disposedAt: finding.disposedAt.toISOString() } : {}),
    createdAt: finding.createdAt.toISOString(),
  };
}

function findingFingerprint(
  category: ResearchCuratorFindingCategoryV1,
  title: string,
  suggestedAction: string,
): string {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  return researchPayloadHash({
    category,
    title: normalize(title),
    action: normalize(suggestedAction),
  });
}

function textFromParts(parts: Prisma.JsonValue): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  return (parts as unknown as MessagePart[])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function detectSignals(text: string): string[] {
  return SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}
