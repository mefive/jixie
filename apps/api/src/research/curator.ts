import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AgentTurnTrace,
  MessagePart,
  ResearchCuratorDispositionV1,
  ResearchCuratorEvidenceV1,
  ResearchCuratorFindingCategoryV1,
  ResearchCuratorFindingV1,
  ResearchCuratorQualityMetricsV1,
  ResearchCuratorRunV1,
  ResearchCuratorVerificationAssessmentV1,
  ResearchCuratorVerificationEvidenceV1,
  ResearchCuratorVerificationMatchV1,
  ResearchCuratorVerificationNoteV1,
} from '@jixie/shared';
import { z } from 'zod';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { chatJson, type LlmCall } from '../llm/deepseek.js';
import { SQL_TABLE_DOCS } from '../agent/tools/read-only-sql.js';
import { TUSHARE_CAPABILITIES } from '../tushare/capability-catalog.js';
import {
  latestTushareCapabilityProbes,
  type StoredTushareCapabilityProbe,
} from '../tushare/capability-probe-store.js';
import { researchCapabilityCatalog } from './catalog.js';
import { crossMarketDataContractRegistry } from './cross-market-data-contracts.js';
import {
  searchCuratorRepositoryReferences,
  type CuratorRepositoryReference,
} from './curator-reference-search.js';
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

export const curatorFindingUpdateSchema = z
  .strictObject({
    disposition: z.enum(['accepted', 'rejected', 'deferred', 'duplicate']).optional(),
    note: z.string().trim().max(500).optional(),
    verificationAssessment: z.enum(['correct', 'incorrect']).optional(),
  })
  .refine((input) => input.disposition || input.verificationAssessment, {
    message: 'disposition or verificationAssessment is required',
  });

const SIGNAL_PATTERNS: Array<[string, RegExp]> = [
  ['supplier', /\b(?:tushare|wind|choice|api|接口|供应商)\b/i],
  ['data_gap', /(?:没有数据|缺少数据|查不到|字段|落库|本地库|数据源|宏观|利率|汇率|库存|持仓)/i],
  ['method', /(?:相关|回归|分布|统计|检验|事件研究|滚动|季节性|状态切换|图表|可视化)/i],
  ['documentation', /(?:什么意思|怎么理解|解释|公式|文档|概念|教程|why|explain|documentation)/i],
  ['correction', /(?:不对|不是|应该|纠正|改成|actually|instead|wrong)/i],
];

const CURATOR_EVIDENCE_CHUNK_SIZE = 80;
const MINIMUM_REVIEWED_FINDINGS = 20;
const MINIMUM_VERIFICATION_ASSESSMENTS = 20;

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
  const latestProbes = await latestTushareCapabilityProbes(
    TUSHARE_CAPABILITIES.map((capability) => capability.apiName),
    database,
  );
  let findingsCreated = 0;
  let duplicatesSkipped = 0;

  for (const draft of drafts) {
    const cited = draft.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is ResearchCuratorEvidenceV1 => Boolean(item));
    if (cited.length === 0 || draft.category === 'no_action') {
      continue;
    }
    const referenceMatches = await searchCuratorRepositoryReferences(
      `${draft.title}\n${draft.summary}\n${cited.map((item) => item.excerpt).join('\n')}`,
    );
    const verification = verifyDraft(
      draft.category,
      draft.title,
      draft.summary,
      cited,
      latestProbes,
      referenceMatches,
    );
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
  return run ? curatorRunRecord(run, await researchCuratorQuality(userId, database)) : null;
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
  return run ? curatorRunRecord(run, await researchCuratorQuality(userId, database)) : null;
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

export async function updateResearchCuratorFindingFeedback(
  userId: string,
  findingId: string,
  input: {
    disposition?: Exclude<ResearchCuratorDispositionV1, 'pending'>;
    note?: string;
    verificationAssessment?: ResearchCuratorVerificationAssessmentV1;
  },
  database: PrismaClient = prisma,
): Promise<ResearchCuratorFindingV1 | null> {
  const existing = await database.researchCuratorFinding.findFirst({
    where: { id: findingId, userId },
    select: { id: true },
  });
  if (!existing) {
    return null;
  }
  const now = new Date();
  const finding = await database.researchCuratorFinding.update({
    where: { id: findingId },
    data: {
      ...(input.disposition
        ? {
            disposition: input.disposition,
            dispositionNote: input.note || null,
            disposedAt: now,
          }
        : {}),
      ...(input.verificationAssessment
        ? {
            verificationAssessment: input.verificationAssessment,
            verificationAssessedAt: now,
          }
        : {}),
    },
  });
  return curatorFindingRecord(finding);
}

export async function researchCuratorQuality(
  userId: string,
  database: PrismaClient = prisma,
): Promise<ResearchCuratorQualityMetricsV1> {
  const [findings, runTotals] = await Promise.all([
    database.researchCuratorFinding.findMany({
      where: { userId },
      select: { disposition: true, verificationAssessment: true },
    }),
    database.researchCuratorRun.aggregate({
      where: { userId },
      _sum: { duplicatesSkipped: true },
    }),
  ]);
  const countDisposition = (value: string) =>
    findings.filter((finding) => finding.disposition === value).length;
  const accepted = countDisposition('accepted');
  const rejected = countDisposition('rejected');
  const duplicates = countDisposition('duplicate');
  const reviewed = accepted + rejected;
  const duplicatesSkipped = runTotals._sum.duplicatesSkipped ?? 0;
  const verificationAssessments = findings.filter(
    (finding) => finding.verificationAssessment !== null,
  ).length;
  const verificationErrors = findings.filter(
    (finding) => finding.verificationAssessment === 'incorrect',
  ).length;
  return {
    totalFindings: findings.length,
    pending: countDisposition('pending'),
    deferred: countDisposition('deferred'),
    reviewed,
    accepted,
    rejected,
    duplicates,
    duplicatesSkipped,
    acceptanceRate: reviewed > 0 ? accepted / reviewed : null,
    duplicateRate:
      findings.length + duplicatesSkipped > 0
        ? (duplicates + duplicatesSkipped) / (findings.length + duplicatesSkipped)
        : null,
    verificationAssessments,
    verificationErrors,
    verificationErrorRate:
      verificationAssessments > 0 ? verificationErrors / verificationAssessments : null,
    evaluationReady:
      reviewed >= MINIMUM_REVIEWED_FINDINGS &&
      verificationAssessments >= MINIMUM_VERIFICATION_ASSESSMENTS,
    minimumReviewedFindings: MINIMUM_REVIEWED_FINDINGS,
    minimumVerificationAssessments: MINIMUM_VERIFICATION_ASSESSMENTS,
  };
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
  latestProbes: Map<string, StoredTushareCapabilityProbe>,
  repositoryReferences: CuratorRepositoryReference[],
): ResearchCuratorFindingV1['verification'] {
  const haystack =
    `${title}\n${summary}\n${evidence.map((item) => item.excerpt).join('\n')}`.toLowerCase();
  const matches: ResearchCuratorVerificationMatchV1[] = [];
  const verificationEvidence: ResearchCuratorVerificationEvidenceV1[] = [];
  const notes = new Set<ResearchCuratorVerificationNoteV1>();
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
      verificationEvidence.push({
        stance: 'supports',
        kind: 'catalog',
        reference: `research-measure:${measure.id}`,
        detailZh: `研究能力目录已有“${measure.nameZh}”指标。`,
        detailEn: `The research capability catalog already contains “${measure.nameEn}”.`,
      });
    }
  }
  for (const protocol of researchCapabilityCatalog.protocols) {
    if (
      haystack.includes(protocol.id.toLowerCase()) ||
      haystack.includes(protocol.nameZh.toLowerCase()) ||
      haystack.includes(protocol.nameEn.toLowerCase())
    ) {
      matches.push({ kind: 'research_protocol', id: protocol.id });
      verificationEvidence.push({
        stance: 'supports',
        kind: 'catalog',
        reference: `research-protocol:${protocol.id}`,
        detailZh: `研究能力目录已有“${protocol.nameZh}”协议。`,
        detailEn: `The research capability catalog already contains “${protocol.nameEn}”.`,
      });
    }
  }
  for (const contract of crossMarketDataContractRegistry.contracts) {
    const aliases = [contract.id, contract.nameZh, contract.nameEn, ...contract.keywords];
    if (aliases.some((alias) => haystack.includes(alias.toLowerCase()))) {
      matches.push({ kind: 'data_contract', id: contract.id });
      verificationEvidence.push({
        stance: contract.status === 'integrated' ? 'supports' : 'limits',
        kind: 'catalog',
        reference: `cross-market-contract:v${contract.version}:${contract.id}`,
        detailZh:
          contract.status === 'integrated'
            ? `跨市场契约已登记“${contract.nameZh}”，市场 ${contract.market}，时区 ${contract.calendar.timeZone}，报价币种 ${contract.currency.quoteCurrency ?? '不适用'}。`
            : `跨市场契约已规划“${contract.nameZh}”，但尚未形成可执行的本地数据能力。`,
        detailEn:
          contract.status === 'integrated'
            ? `The cross-market registry contains the integrated “${contract.nameEn}” contract for ${contract.market}, ${contract.calendar.timeZone}, quote currency ${contract.currency.quoteCurrency ?? 'not applicable'}.`
            : `The cross-market registry plans “${contract.nameEn}”, but it is not yet an executable local-data capability.`,
      });
      notes.add('cross_market_contract_match');
    }
  }
  for (const decision of crossMarketDataContractRegistry.sourceDecisions) {
    const aliases = [decision.id, decision.nameZh, decision.nameEn, ...decision.keywords];
    if (aliases.some((alias) => haystack.includes(alias.toLowerCase()))) {
      matches.push({ kind: 'data_source_decision', id: decision.id });
      verificationEvidence.push({
        stance: decision.status === 'integrated' ? 'supports' : 'limits',
        kind: 'catalog',
        reference: `source-decision:v${decision.version}:${decision.id}`,
        detailZh:
          decision.status === 'integrated'
            ? `数据源矩阵已登记可运行来源“${decision.nameZh}”；再分发权状态为 ${decision.license.redistribution}。`
            : `数据源矩阵仅把“${decision.nameZh}”列为候选；${decision.decision}`,
        detailEn:
          decision.status === 'integrated'
            ? `The source matrix registers the operational source “${decision.nameEn}”; redistribution remains ${decision.license.redistribution}.`
            : `The source matrix lists “${decision.nameEn}” only as a candidate. ${decision.decision}`,
      });
      notes.add('source_decision_match');
    }
  }
  for (const tableName of Object.keys(SQL_TABLE_DOCS)) {
    if (haystack.includes(tableName.toLowerCase())) {
      matches.push({ kind: 'local_data_table', id: tableName });
      verificationEvidence.push({
        stance: 'supports',
        kind: 'catalog',
        reference: `local-table:${tableName}`,
        detailZh: `只读查询目录已登记本地表 ${tableName}。`,
        detailEn: `The read-only query catalog registers local table ${tableName}.`,
      });
    }
  }
  for (const capability of TUSHARE_CAPABILITIES) {
    const aliases = [
      capability.apiName,
      capability.nameZh,
      capability.nameEn,
      ...capability.keywords,
    ];
    if (aliases.some((alias) => haystack.includes(alias.toLowerCase()))) {
      matches.push({ kind: 'tushare_api', id: capability.apiName });
      verificationEvidence.push({
        stance: 'supports',
        kind: 'catalog',
        reference: `tushare-catalog:v${capability.version}:${capability.apiName}`,
        detailZh: `${capability.nameZh}（${capability.apiName}）已登记；频率 ${capability.history.frequency}，所需字段 ${capability.requiredFields.join(', ') || '待权限验证'}，权限 ${permissionDescription(capability.permission, 'zh')}。`,
        detailEn: `${capability.nameEn} (${capability.apiName}) is cataloged; frequency ${capability.history.frequency}, required fields ${capability.requiredFields.join(', ') || 'pending permission verification'}, permission ${permissionDescription(capability.permission, 'en')}.`,
      });
      const probe = latestProbes.get(capability.apiName);
      if (!probe) {
        notes.add('tushare_catalog_match_requires_smoke_check');
        continue;
      }
      const available = probe.status === 'ok';
      const permissionDenied = probe.status === 'permission_denied';
      verificationEvidence.push({
        stance: available ? 'supports' : 'limits',
        kind: 'probe',
        reference: `tushare-probe:${probe.apiName}:${probe.probedAt.toISOString()}`,
        detailZh: probeDescription(probe, 'zh'),
        detailEn: probeDescription(probe, 'en'),
      });
      notes.add(
        available
          ? 'tushare_probe_available'
          : permissionDenied
            ? 'tushare_probe_permission_denied'
            : probe.status === 'empty'
              ? 'tushare_probe_empty'
              : 'tushare_api_unverified',
      );
    }
  }
  for (const reference of repositoryReferences) {
    matches.push({ kind: reference.kind, id: reference.id });
    verificationEvidence.push({
      stance: 'supports',
      kind: 'repository',
      reference: reference.id,
      detailZh: `只读检索命中：${reference.excerpt}`,
      detailEn: `Read-only repository match: ${reference.excerpt}`,
    });
    notes.add('repository_reference_match');
  }
  const unique = [
    ...new Map(matches.map((match) => [`${match.kind}:${match.id}`, match])).values(),
  ];
  const locallyVerified = unique.some((match) =>
    [
      'research_measure',
      'research_protocol',
      'data_contract',
      'data_source_decision',
      'local_data_table',
    ].includes(match.kind),
  );
  const repositoryMatched = repositoryReferences.length > 0;
  if (locallyVerified) {
    notes.add('local_capability_match');
  }
  const supplierMatches = unique.filter((match) => match.kind === 'tushare_api');
  const supplierProbeVerified = supplierMatches.some((match) => {
    const status = latestProbes.get(match.id)?.status;
    return status === 'ok' || status === 'permission_denied';
  });
  const status =
    supplierMatches.length > 0
      ? supplierProbeVerified
        ? 'verified'
        : 'partial'
      : locallyVerified || repositoryMatched
        ? 'verified'
        : 'unverified';
  if (unique.length === 0) {
    notes.add(
      category === 'supplier_data_gap' ? 'tushare_api_unverified' : 'local_capability_unverified',
    );
  }
  return {
    status,
    matches: unique,
    notes: [...notes],
    evidence: verificationEvidence,
  };
}

function curatorRunRecord(
  run: CuratorRunWithRelations,
  quality: ResearchCuratorQualityMetricsV1,
): ResearchCuratorRunV1 {
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
    quality,
    ...(run.error ? { error: run.error } : {}),
    findings: run.findings.map(curatorFindingRecord),
    createdAt: run.createdAt.toISOString(),
  };
}

function curatorFindingRecord(finding: CuratorFindingRecord): ResearchCuratorFindingV1 {
  const persistedVerification = finding.verification as unknown as Partial<
    ResearchCuratorFindingV1['verification']
  >;
  return {
    version: 1,
    id: finding.id,
    runId: finding.runId,
    category: finding.category as ResearchCuratorFindingV1['category'],
    title: finding.title,
    summary: finding.summary,
    evidence: finding.evidence as unknown as ResearchCuratorFindingV1['evidence'],
    verification: {
      status: persistedVerification.status ?? 'unverified',
      matches: Array.isArray(persistedVerification.matches) ? persistedVerification.matches : [],
      notes: Array.isArray(persistedVerification.notes) ? persistedVerification.notes : [],
      evidence: Array.isArray(persistedVerification.evidence) ? persistedVerification.evidence : [],
    },
    confidence: finding.confidence,
    expectedValue: finding.expectedValue,
    changeSurface: finding.changeSurface as unknown as ResearchCuratorFindingV1['changeSurface'],
    suggestedAction: finding.suggestedAction,
    fingerprint: finding.fingerprint,
    disposition: finding.disposition as ResearchCuratorFindingV1['disposition'],
    ...(finding.dispositionNote ? { dispositionNote: finding.dispositionNote } : {}),
    ...(finding.disposedAt ? { disposedAt: finding.disposedAt.toISOString() } : {}),
    ...(finding.verificationAssessment
      ? {
          verificationAssessment:
            finding.verificationAssessment as ResearchCuratorVerificationAssessmentV1,
        }
      : {}),
    ...(finding.verificationAssessedAt
      ? { verificationAssessedAt: finding.verificationAssessedAt.toISOString() }
      : {}),
    createdAt: finding.createdAt.toISOString(),
  };
}

function permissionDescription(
  permission: (typeof TUSHARE_CAPABILITIES)[number]['permission'],
  language: 'zh' | 'en',
): string {
  if (permission.kind === 'points') {
    return language === 'zh'
      ? `至少 ${permission.minimumPoints} 积分（截至 ${permission.documentedAsOf}）`
      : `at least ${permission.minimumPoints} points (as of ${permission.documentedAsOf})`;
  }
  if (permission.kind === 'separate_permission') {
    return language === 'zh'
      ? `需单独权限（截至 ${permission.documentedAsOf}）`
      : `separate permission required (as of ${permission.documentedAsOf})`;
  }
  return language === 'zh' ? '随 Token 权限而定' : 'token-dependent';
}

function probeDescription(probe: StoredTushareCapabilityProbe, language: 'zh' | 'en'): string {
  const history = probe.history ? `${probe.history.start}–${probe.history.end}` : '—';
  if (language === 'zh') {
    return `最近探测 ${probe.probedAt.toISOString()}：${probe.status}，${probe.rowCount} 行，字段 ${probe.fields.join(', ') || '—'}，观测区间 ${history}。`;
  }
  return `Latest probe ${probe.probedAt.toISOString()}: ${probe.status}, ${probe.rowCount} rows, fields ${probe.fields.join(', ') || '—'}, observed range ${history}.`;
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
