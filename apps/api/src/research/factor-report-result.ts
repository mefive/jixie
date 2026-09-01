import type { FactorResearchSpecV1 } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { parseResearchIntent } from '../factor/research.js';
import { normalizeFactorResearchSpec } from '../factor/report-spec.js';

const MAX_FACTOR_REPORT_PAYLOAD_BYTES = 4 * 1024 * 1024;

type ResearchJsonValue =
  | null
  | boolean
  | number
  | string
  | ResearchJsonValue[]
  | { [key: string]: ResearchJsonValue };

export interface ResearchFactorReportResultV1 extends Record<string, unknown> {
  version: 1;
  report_id: string;
  factor: string;
  analysis_kind: FactorResearchSpecV1['analysisKind'];
  status: 'done';
  phase: 'legacy' | 'explore' | 'holdout';
  language: 'typescript' | 'python';
  runtime_version: 'ts-v1' | 'py-v1';
  created_at: string;
  computed_at: string | null;
  research_spec: ResearchJsonValue;
  research_intent: ResearchJsonValue;
  lineage: {
    factor_code_hash: string | null;
    data_revision: string | null;
    parent_report_id: string | null;
  };
  report: ResearchJsonValue;
}

export async function loadResearchFactorReportResult(
  documentId: string,
  reportId: string,
): Promise<ResearchFactorReportResultV1> {
  const document = await prisma.agentConversation.findFirst({
    where: { id: documentId, surface: 'research', archivedAt: null },
    select: { userId: true, researchDocument: { select: { id: true } } },
  });
  if (!document?.researchDocument) {
    throw new Error('Research document was not found.');
  }

  const row = await prisma.factorReport.findFirst({
    where: { id: reportId, userId: document.userId },
    select: {
      id: true,
      factor: true,
      status: true,
      phase: true,
      language: true,
      freq: true,
      neutral: true,
      start: true,
      end: true,
      specJson: true,
      payload: true,
      factorCodeHash: true,
      dataRevision: true,
      parentReportId: true,
      researchIntentJson: true,
      revealedAt: true,
      createdAt: true,
      computedAt: true,
    },
  });
  if (!row) {
    throw new Error('Factor report was not found.');
  }
  if (row.phase === 'holdout' && row.revealedAt === null) {
    throw new Error('Factor holdout report is sealed until it is explicitly revealed.');
  }
  if (row.status !== 'done') {
    throw new Error(`Factor report is not complete: ${row.status}.`);
  }
  if (!row.payload) {
    throw new Error('Factor report has no result payload.');
  }
  if (Buffer.byteLength(row.payload, 'utf8') > MAX_FACTOR_REPORT_PAYLOAD_BYTES) {
    throw new Error('Factor report exceeds the Research result transfer limit.');
  }

  const researchSpec = factorReportResearchSpec(row);
  const researchIntent = parseResearchIntent(row.researchIntentJson) ?? null;
  const report = parseJsonObject(row.payload, 'Factor report payload');

  return {
    version: 1,
    report_id: row.id,
    factor: row.factor,
    analysis_kind: researchSpec.analysisKind,
    status: 'done',
    phase: row.phase === 'explore' || row.phase === 'holdout' ? row.phase : 'legacy',
    language: row.language === 'python' ? 'python' : 'typescript',
    runtime_version: row.language === 'python' ? 'py-v1' : 'ts-v1',
    created_at: row.createdAt.toISOString(),
    computed_at: row.computedAt?.toISOString() ?? null,
    research_spec: snakeCaseJson(researchSpec),
    research_intent: snakeCaseJson(researchIntent),
    lineage: {
      factor_code_hash: row.factorCodeHash,
      data_revision: row.dataRevision,
      parent_report_id: row.parentReportId,
    },
    report: snakeCaseJson(report),
  };
}

interface FactorReportSpecRow {
  specJson: string | null;
  freq: string;
  start: string;
  end: string;
  neutral: string;
}

function factorReportResearchSpec(row: FactorReportSpecRow): FactorResearchSpecV1 {
  if (row.specJson) {
    try {
      return normalizeFactorResearchSpec(JSON.parse(row.specJson));
    } catch {
      // Legacy rows retain enough normalized columns for a safe compatibility view.
    }
  }

  return normalizeFactorResearchSpec({
    version: 1,
    freq: row.freq === 'week' ? 'week' : 'month',
    start: row.start,
    end: row.end,
    neutral: row.neutral === 'size' || row.neutral === 'size_industry' ? row.neutral : 'none',
  });
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is invalid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object.`);
  }
  return parsed as Record<string, unknown>;
}

function snakeCaseJson(value: unknown): ResearchJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Factor report contains a non-finite number.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(snakeCaseJson);
  }
  if (typeof value !== 'object') {
    throw new Error('Factor report contains an unsupported JSON value.');
  }

  const result: Record<string, ResearchJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }
    const normalizedKey = key
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
    if (normalizedKey in result) {
      throw new Error(`Factor report contains ambiguous keys after normalization: ${key}.`);
    }
    result[normalizedKey] = snakeCaseJson(item);
  }
  return result;
}
