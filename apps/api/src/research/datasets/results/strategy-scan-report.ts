import { strategyResultSettings } from '#strategy/definitions/config.js';
import { strategyScanReportState } from '#strategy/scans/state.js';
import { getDatabase } from '#infra/database/prisma.js';

const MAX_STRATEGY_SCAN_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * 约束扫描输出中的 JSON 值，供安全映射。
 *
 * Constrain JSON values mapped from scan results.
 */
type ResearchJsonValue =
  | null
  | boolean
  | number
  | string
  | ResearchJsonValue[]
  | { [key: string]: ResearchJsonValue };

/**
 * 读取已授权扫描报告的保留组合结果，供 Python 研究分析。
 *
 * Read authorized retained scan combinations for Python research analysis.
 */
export async function loadResearchStrategyScanReportResult(documentId: string, reportId: string) {
  const userId = await researchDocumentUserId(documentId);
  const row = await getDatabase()
    .strategyScanReport.findFirst({
      where: { id: reportId, userId },
      select: {
        legacyError: true,
        job: true,
        id: true,
        strategyId: true,
        strategyName: true,
        legacyStatus: true,
        settings: true,
        spec: true,
        dataCutoff: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    .then((row) => (row ? strategyScanReportState(row) : row));
  if (!row) {
    throw new Error('Strategy scan report was not found.');
  }
  if (row.status !== 'done') {
    throw new Error(`Strategy scan report is not complete: ${row.status}.`);
  }
  if (!row.payload) {
    throw new Error('Strategy scan report has no result payload.');
  }
  if (Buffer.byteLength(JSON.stringify(row.payload), 'utf8') > MAX_STRATEGY_SCAN_PAYLOAD_BYTES) {
    throw new Error('Strategy scan report exceeds the Research result transfer limit.');
  }
  return {
    version: 1,
    report_id: row.id,
    strategy_id: row.strategyId,
    strategy_name: row.strategyName,
    status: 'done',
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    data_cutoff: row.dataCutoff,
    settings: snakeCaseJson(strategyResultSettings(row.settings)),
    spec: snakeCaseJson(row.spec),
    report: snakeCaseJson(row.payload),
  };
}

async function researchDocumentUserId(documentId: string): Promise<string> {
  const document = await getDatabase().agentConversation.findFirst({
    where: { id: documentId, surface: 'research', archivedAt: null },
    select: { userId: true, researchDocument: { select: { id: true } } },
  });
  if (!document?.researchDocument) {
    throw new Error('Research document was not found.');
  }
  return document.userId;
}

/**
 * 递归转换扫描结果键名，供 Python 作者统一读取。
 *
 * Recursively convert scan result keys for Python author access.
 */
function snakeCaseJson(value: unknown): ResearchJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Research result contains a non-finite number.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(snakeCaseJson);
  }
  if (typeof value !== 'object') {
    throw new Error('Research result contains an unsupported JSON value.');
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
      throw new Error(`Research result contains ambiguous keys after normalization: ${key}.`);
    }
    result[normalizedKey] = snakeCaseJson(item);
  }
  return result;
}
