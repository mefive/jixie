import { reportResearchSpec } from '#factor/evaluations/report-spec.js';
import { factorReportState } from '#factor/evaluations/state.js';
import type { FactorResearchSpecV1 } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';

const MAX_FACTOR_REPORT_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * 限制因子报告可序列化值，供公开 Python 结果。
 *
 * Constrain serializable factor-report values for public Python results.
 */
type ResearchJsonValue =
  | null
  | boolean
  | number
  | string
  | ResearchJsonValue[]
  | { [key: string]: ResearchJsonValue };

/**
 * 封装可见因子报告的冻结研究规格和结果。
 *
 * Collect visible frozen factor research specifications and results.
 */
export interface ResearchFactorReportResultV1 extends Record<string, unknown> {
  version: 1;
  report_id: string;
  factor: string;
  analysis_kind: FactorResearchSpecV1['analysisKind'];
  status: 'done';
  language: 'typescript' | 'python';
  runtime_version: 'ts-v1' | 'py-v1';
  created_at: string;
  computed_at: string | null;
  research_spec: ResearchJsonValue;
  lineage: {
    factor_code_hash: string | null;
    data_revision: string | null;
  };
  report: ResearchJsonValue;
}

/**
 * 校验因子报告归属与完成状态，再输出冻结研究结果。
 *
 * Authorize factor report ownership and completion state before returning frozen evidence.
 */
export async function loadResearchFactorReportResult(
  documentId: string,
  reportId: string,
): Promise<ResearchFactorReportResultV1> {
  const document = await getDatabase().agentConversation.findFirst({
    where: { id: documentId, surface: 'research', archivedAt: null },
    select: { userId: true, researchDocument: { select: { id: true } } },
  });
  if (!document?.researchDocument) {
    throw new Error('Research document was not found.');
  }

  const row = await getDatabase()
    .factorReport.findFirst({
      where: { id: reportId, userId: document.userId },
      select: {
        failureMessage: true,
        job: true,
        id: true,
        factor: true,
        legacyStatus: true,
        language: true,
        freq: true,
        neutral: true,
        start: true,
        end: true,
        specJson: true,
        payload: true,
        factorCodeHash: true,
        factorCodeSnapshot: true,
        dataRevision: true,
        createdAt: true,
        computedAt: true,
      },
    })
    .then((row) => (row ? factorReportState(row) : row));
  if (!row) {
    throw new Error('Factor report was not found.');
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

  const researchSpec = reportResearchSpec(row);
  const report = parseJsonObject(row.payload, 'Factor report payload');

  return {
    version: 1,
    report_id: row.id,
    factor: row.factor,
    analysis_kind: researchSpec.analysisKind,
    status: 'done',
    language: row.language === 'python' ? 'python' : 'typescript',
    runtime_version: row.language === 'python' ? 'py-v1' : 'ts-v1',
    created_at: row.createdAt.toISOString(),
    computed_at: row.computedAt?.toISOString() ?? null,
    research_spec: snakeCaseJson(researchSpec),
    lineage: {
      factor_code_hash: row.factorCodeHash,
      data_revision: row.dataRevision,
    },
    report: snakeCaseJson(report),
  };
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

/**
 * 将因子结果 JSON 的键转换为 snake_case，保持数值与空值。
 *
 * Convert factor result JSON keys to snake_case without changing values or nulls.
 */
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
