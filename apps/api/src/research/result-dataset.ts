import { factorWeatherMethodology } from '../factor/weather.js';
import { prisma } from '../lib/prisma.js';

const MAX_STRATEGY_SCAN_PAYLOAD_BYTES = 4 * 1024 * 1024;

type ResearchJsonValue =
  | null
  | boolean
  | number
  | string
  | ResearchJsonValue[]
  | { [key: string]: ResearchJsonValue };

export async function loadResearchStrategyScanReportResult(documentId: string, reportId: string) {
  const userId = await researchDocumentUserId(documentId);
  const row = await prisma.strategyScanReport.findFirst({
    where: { id: reportId, userId },
    select: {
      id: true,
      strategyId: true,
      strategyName: true,
      status: true,
      config: true,
      spec: true,
      codeHash: true,
      dataCutoff: true,
      payload: true,
      createdAt: true,
      updatedAt: true,
    },
  });
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
    lineage: { code_hash: row.codeHash },
    config: snakeCaseJson(row.config),
    spec: snakeCaseJson(row.spec),
    report: snakeCaseJson(row.payload),
  };
}

export async function loadResearchFactorWeatherResult(documentId: string, factorId: string) {
  const userId = await researchDocumentUserId(documentId);
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { userId, factorId },
    select: {
      factorId: true,
      factorName: true,
      direction: true,
      status: true,
      computedThrough: true,
      factorCodeHash: true,
      points: {
        orderBy: { periodEndDate: 'asc' },
        select: {
          formationDate: true,
          periodEndDate: true,
          rankIc: true,
          topReturn: true,
          bottomReturn: true,
          longShortGrossReturn: true,
          longShortNetReturn: true,
          topTurnover: true,
          sampleSize: true,
          sampleCoverage: true,
        },
      },
    },
  });
  if (!pin) {
    throw new Error('Factor Weather pin was not found.');
  }
  if (pin.status !== 'ready') {
    throw new Error(`Factor Weather pin is not ready: ${pin.status}.`);
  }
  return {
    rows: pin.points.map((point) => ({
      formation_date: point.formationDate,
      period_end_date: point.periodEndDate,
      rank_ic: point.rankIc,
      top_return: point.topReturn,
      bottom_return: point.bottomReturn,
      long_short_gross_return: point.longShortGrossReturn,
      long_short_net_return: point.longShortNetReturn,
      top_turnover: point.topTurnover,
      sample_size: point.sampleSize,
      sample_coverage: point.sampleCoverage,
    })),
    metadata: {
      factor_id: pin.factorId,
      factor_name: pin.factorName,
      direction: pin.direction,
      computed_through: pin.computedThrough,
      code_hash: pin.factorCodeHash,
      methodology: snakeCaseJson(factorWeatherMethodology()),
    },
  };
}

async function researchDocumentUserId(documentId: string): Promise<string> {
  const document = await prisma.agentConversation.findFirst({
    where: { id: documentId, surface: 'research', archivedAt: null },
    select: { userId: true, researchDocument: { select: { id: true } } },
  });
  if (!document?.researchDocument) {
    throw new Error('Research document was not found.');
  }
  return document.userId;
}

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
