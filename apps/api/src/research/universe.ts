import type { PrismaClient } from '@prisma/client';
import type {
  ResearchDiagnosticV1,
  ResearchUniverseRowV1,
  ResearchUniverseRunResultV1,
  ResearchUniverseStageV1,
  UniverseSpecV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { researchUniverseMeasureById } from './catalog.js';
import { parseUniverseSpec } from './spec.js';

type UniverseValueRow = ResearchUniverseRowV1 & { values: Record<string, number | null> };

const DEFAULT_LIMIT = 50;

export interface ExecuteUniverseSpecOptions {
  defaultLimit?: number | null;
}

/** Execute one validated point-in-time equity universe without accepting SQL from the caller. */
export async function executeUniverseSpec(
  input: unknown,
  database: PrismaClient = prisma,
  options: ExecuteUniverseSpecOptions = {},
): Promise<ResearchUniverseRunResultV1> {
  const spec = parseUniverseSpec(input);
  if (spec.asOf.kind === 'periodic') {
    throw new Error('Universe snapshot execution requires fixed or latest_available asOf');
  }
  const requestedAsOfDate = spec.asOf.kind === 'fixed' ? spec.asOf.date : null;
  const snapshot = await database.dailyBasic.findFirst({
    ...(requestedAsOfDate ? { where: { tradeDate: { lte: requestedAsOfDate } } } : {}),
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  if (!snapshot) {
    throw new Error('No DailyBasic snapshot is available at the requested time');
  }
  const asOfDate = snapshot.tradeDate;
  const diagnostics: ResearchDiagnosticV1[] = [];
  if (requestedAsOfDate && requestedAsOfDate !== asOfDate) {
    diagnostics.push({
      code: 'UNIVERSE_PREVIOUS_TRADING_DAY',
      severity: 'info',
      messageZh: `请求日期 ${requestedAsOfDate} 没有截面，使用此前最近交易日 ${asOfDate}。`,
      messageEn: `No snapshot exists on ${requestedAsOfDate}; the latest prior trading date ${asOfDate} was used.`,
    });
  }

  const source = await resolveSource(database, spec, asOfDate);
  const dailyBasics = await database.dailyBasic.findMany({
    where: { tradeDate: asOfDate, ...(source.codes ? { tsCode: { in: source.codes } } : {}) },
  });
  const candidateCodes = dailyBasics.map((row) => row.tsCode);
  const [daily, basics, names, industries, state] = await Promise.all([
    database.daily.findMany({
      where: { tradeDate: asOfDate, tsCode: { in: candidateCodes } },
      select: { tsCode: true, close: true, pctChg: true },
    }),
    database.stockBasic.findMany({
      where: { tsCode: { in: candidateCodes } },
      select: {
        tsCode: true,
        name: true,
        industry: true,
        listDate: true,
        delistDate: true,
      },
    }),
    database.stockNameHistory.findMany({
      where: {
        tsCode: { in: candidateCodes },
        startDate: { lte: asOfDate },
        OR: [{ endDate: null }, { endDate: { gte: asOfDate } }],
      },
      select: { tsCode: true, name: true, startDate: true },
      orderBy: { startDate: 'desc' },
    }),
    database.swIndustryMember.findMany({
      where: {
        tsCode: { in: candidateCodes },
        inDate: { lte: asOfDate },
        OR: [{ outDate: null }, { outDate: { gt: asOfDate } }],
      },
      select: { tsCode: true, l1Name: true, inDate: true },
      orderBy: { inDate: 'desc' },
    }),
    database.maintenanceState.findUnique({
      where: { key: 'global' },
      select: { dataRevision: true },
    }),
  ]);
  const dailyByCode = new Map(daily.map((row) => [row.tsCode, row]));
  const basicByCode = new Map(basics.map((row) => [row.tsCode, row]));
  const nameByCode = firstByCode(names, (row) => row.tsCode);
  const industryByCode = firstByCode(industries, (row) => row.tsCode);
  const requiresHistoricalMetadata = spec.asOf.kind === 'fixed';
  const missingHistoricalNames = requiresHistoricalMetadata
    ? candidateCodes.filter((code) => !nameByCode.has(code)).length
    : 0;
  if (missingHistoricalNames > 0) {
    diagnostics.push({
      code: 'UNIVERSE_HISTORICAL_NAME_MISSING',
      severity: 'warning',
      messageZh: `${missingHistoricalNames} 个候选缺少所选时点的历史名称；名称显示为代码，排除风险警示时这些对象不会进入结果。`,
      messageEn: `${missingHistoricalNames} candidates lack a historical name at the selected date; their id is displayed, and they cannot pass risk-warning exclusion.`,
    });
  }

  const stages: ResearchUniverseStageV1[] = [{ code: 'source', count: dailyBasics.length }];
  let rows = dailyBasics
    .filter((row) => {
      const basic = basicByCode.get(row.tsCode);
      return (
        basic !== undefined &&
        basic.listDate !== null &&
        basic.listDate <= asOfDate &&
        (basic.delistDate === null || basic.delistDate > asOfDate) &&
        daysBetween(basic.listDate, asOfDate) >= spec.eligibility.minimumListedDays
      );
    })
    .map((row): UniverseValueRow => {
      const basic = basicByCode.get(row.tsCode)!;
      const price = dailyByCode.get(row.tsCode);
      return {
        entity: { assetType: 'stock', id: row.tsCode },
        name:
          nameByCode.get(row.tsCode)?.name ??
          (requiresHistoricalMetadata ? row.tsCode : basic.name),
        industry:
          industryByCode.get(row.tsCode)?.l1Name ??
          (requiresHistoricalMetadata ? null : basic.industry),
        values: {
          'equity.close': price?.close ?? null,
          'equity.daily_return_pct': price?.pctChg ?? null,
          'equity.pe': row.pe,
          'equity.pe_ttm': row.peTtm,
          'equity.pb': row.pb,
          'equity.ps': row.ps,
          'equity.dividend_yield_pct': row.dvRatio,
          'equity.total_market_cap_cny_10k': row.totalMv,
          'equity.float_market_cap_cny_10k': row.circMv,
          'equity.turnover_rate_pct': row.turnoverRate,
        },
      };
    });
  stages.push({ code: 'listed', count: rows.length });
  rows = rows.filter((row) => dailyByCode.has(row.entity.id));
  stages.push({ code: 'not_suspended', count: rows.length });
  if (spec.eligibility.riskWarning === 'exclude') {
    rows = rows.filter(
      (row) =>
        (!requiresHistoricalMetadata || nameByCode.has(row.entity.id)) &&
        !isRiskWarningName(row.name),
    );
  }
  stages.push({ code: 'risk_warning', count: rows.length });
  const applied = applyUniverseSpec(
    rows,
    spec,
    options.defaultLimit === undefined ? DEFAULT_LIMIT : options.defaultLimit,
  );
  stages.push({ code: 'predicates', count: applied.total });

  const selectedMeasures = spec.select.map((ref) => researchUniverseMeasureById.get(ref.measure)!);
  return {
    version: 1,
    spec,
    requestedAsOfDate,
    asOfDate,
    membershipAsOfDate: source.membershipAsOfDate,
    dataRevision: state?.dataRevision ?? 0,
    total: applied.total,
    rows: applied.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(
        spec.select.map(({ measure }) => [measure, row.values[measure] ?? null]),
      ),
    })),
    measures: selectedMeasures,
    stages,
    diagnostics,
  };
}

export function applyUniverseSpec(
  inputRows: UniverseValueRow[],
  spec: UniverseSpecV1,
  defaultLimit: number | null = DEFAULT_LIMIT,
): { total: number; rows: UniverseValueRow[] } {
  let rows = inputRows.filter((row) =>
    spec.predicates.every((predicate) => {
      const value = row.values[predicate.measure];
      if (value == null || !Number.isFinite(value) || typeof predicate.value !== 'number') {
        return false;
      }
      switch (predicate.op) {
        case '>':
          return value > predicate.value;
        case '>=':
          return value >= predicate.value;
        case '<':
          return value < predicate.value;
        case '<=':
          return value <= predicate.value;
        case '==':
          return value === predicate.value;
        case '!=':
          return value !== predicate.value;
      }
    }),
  );
  const total = rows.length;
  if (spec.sort) {
    const { measure, direction } = spec.sort;
    const sign = direction === 'asc' ? 1 : -1;
    rows = [...rows].sort((left, right) => {
      const leftValue = left.values[measure];
      const rightValue = right.values[measure];
      if (leftValue == null && rightValue == null) {
        return left.entity.id.localeCompare(right.entity.id);
      }
      if (leftValue == null) {
        return 1;
      }
      if (rightValue == null) {
        return -1;
      }
      return (leftValue - rightValue) * sign || left.entity.id.localeCompare(right.entity.id);
    });
  }
  const limit = spec.limit ?? defaultLimit;
  return { total, rows: limit == null ? rows : rows.slice(0, limit) };
}

async function resolveSource(
  database: PrismaClient,
  spec: UniverseSpecV1,
  asOfDate: string,
): Promise<{ codes: string[] | null; membershipAsOfDate: string | null }> {
  if (spec.source.kind === 'equity_market') {
    return { codes: null, membershipAsOfDate: null };
  }
  if (spec.source.kind === 'explicit') {
    const unsupported = spec.source.entities.filter((entity) => entity.assetType !== 'stock');
    if (unsupported.length > 0) {
      throw new Error('UniverseSpec V1 equity measures support stock entities only');
    }
    return {
      codes: [...new Set(spec.source.entities.map((entity) => entity.id))],
      membershipAsOfDate: null,
    };
  }
  const membership = await database.indexWeight.findFirst({
    where: { indexCode: spec.source.indexCode, tradeDate: { lte: asOfDate } },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  if (!membership) {
    throw new Error(`No index membership snapshot for ${spec.source.indexCode} by ${asOfDate}`);
  }
  const members = await database.indexWeight.findMany({
    where: { indexCode: spec.source.indexCode, tradeDate: membership.tradeDate },
    select: { conCode: true },
  });
  return {
    codes: members.map((row) => row.conCode),
    membershipAsOfDate: membership.tradeDate,
  };
}

function firstByCode<T>(rows: T[], code: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!result.has(code(row))) {
      result.set(code(row), row);
    }
  }
  return result;
}

function daysBetween(start: string, end: string): number {
  const parse = (value: string) =>
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.floor((parse(end) - parse(start)) / 86_400_000);
}

function isRiskWarningName(name: string): boolean {
  return /(?:\*?ST|退)/i.test(name);
}
