import type { BacktestConfig } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

const MAX_BACKTEST_REPORT_PAYLOAD_BYTES = 8 * 1024 * 1024;

type ResearchJsonValue =
  | null
  | boolean
  | number
  | string
  | ResearchJsonValue[]
  | { [key: string]: ResearchJsonValue };

export interface ResearchBacktestReportResultV1 extends Record<string, unknown> {
  version: 1;
  report_id: string;
  strategy_id: string;
  strategy_name: string;
  status: 'done';
  created_at: string;
  computed_at: string | null;
  backtest_spec: ResearchJsonValue;
  lineage: { code_hash: string | null; result_hash: string | null };
  report: ResearchJsonValue;
}

export async function loadResearchBacktestReportResult(
  documentId: string,
  reportId: string,
): Promise<ResearchBacktestReportResultV1> {
  const document = await prisma.agentConversation.findFirst({
    where: { id: documentId, surface: 'research', archivedAt: null },
    select: { userId: true, researchDocument: { select: { id: true } } },
  });
  if (!document?.researchDocument) {
    throw new Error('Research document was not found.');
  }

  const row = await prisma.backtestReport.findFirst({
    where: { id: reportId, userId: document.userId },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      status: true,
      config: true,
      codeHash: true,
      resultHash: true,
      payload: true,
      createdAt: true,
      computedAt: true,
    },
  });
  if (!row) {
    throw new Error('Backtest report was not found.');
  }
  if (row.status !== 'done') {
    throw new Error(`Backtest report is not complete: ${row.status}.`);
  }
  if (!row.payload) {
    throw new Error('Backtest report has no result payload.');
  }
  const serializedPayload = JSON.stringify(row.payload);
  if (Buffer.byteLength(serializedPayload, 'utf8') > MAX_BACKTEST_REPORT_PAYLOAD_BYTES) {
    throw new Error('Backtest report exceeds the Research result transfer limit.');
  }

  const config = row.config as unknown as BacktestConfig;
  return {
    version: 1,
    report_id: row.id,
    strategy_id: row.strategyId,
    strategy_name: row.strategyName,
    status: 'done',
    created_at: row.createdAt.toISOString(),
    computed_at: row.computedAt?.toISOString() ?? null,
    backtest_spec: snakeCaseJson({
      start: config.start,
      end: config.end,
      initialCash: config.initialCash,
      cost: config.cost ?? null,
      language: config.language ?? 'typescript',
      runtimeVersion: config.runtimeVersion ?? 'ts-v1',
    }),
    lineage: { code_hash: row.codeHash, result_hash: row.resultHash },
    report: snakeCaseJson(row.payload),
  };
}

function snakeCaseJson(value: unknown): ResearchJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Backtest report contains a non-finite number.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(snakeCaseJson);
  }
  if (typeof value !== 'object') {
    throw new Error('Backtest report contains an unsupported JSON value.');
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
      throw new Error(`Backtest report contains ambiguous keys after normalization: ${key}.`);
    }
    result[normalizedKey] = snakeCaseJson(item);
  }
  return result;
}
