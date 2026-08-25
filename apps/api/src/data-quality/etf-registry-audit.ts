import { median } from '../lib/stats.js';
import type { Prisma } from '../lib/prisma.js';
import {
  ETF_RESEARCH_CODES,
  ETF_RESEARCH_REGISTRY,
  ETF_RESEARCH_SELECTION_AS_OF,
  type EtfResearchMembership,
  etfResearchMembership,
} from '../store/etf-research-registry.js';

export interface EtfRegistryProductAudit {
  tsCode: string;
  name: string | null;
  membership: EtfResearchMembership;
  benchmarkMatches: boolean;
  lifecycleMatches: boolean;
  expectedStartDate: string | null;
  dailyRows: number;
  dailyStartDate: string | null;
  dailyEndDate: string | null;
  adjustmentRows: number;
  adjustmentStartDate: string | null;
  adjustmentEndDate: string | null;
  trailingMedianAmount: number | null;
  shareSizeRows: number;
  shareSizeStartDate: string | null;
  shareSizeEndDate: string | null;
  latestTotalShare: number | null;
  latestTotalSize: number | null;
}

export interface EtfRegistryAuditReport {
  registryVersion: number;
  selectionAsOf: string;
  expectedHistoryStart: string;
  coverageThrough: string;
  exposures: number;
  products: number;
  errors: string[];
  warnings: string[];
  rows: EtfRegistryProductAudit[];
}

export async function auditEtfResearchRegistry(
  database: Prisma,
  options: { expectedHistoryStart?: string; coverageThrough?: string } = {},
): Promise<EtfRegistryAuditReport> {
  const expectedHistoryStart = options.expectedHistoryStart ?? '20150101';
  const coverageThrough = options.coverageThrough ?? (await latestRegistryAuditDate(database));
  const codes = [...ETF_RESEARCH_CODES];
  const [
    metadata,
    dailyCoverage,
    adjustmentCoverage,
    shareSizeCoverage,
    historyDates,
    trailingDates,
  ] = await Promise.all([
    database.etfBasic.findMany({
      where: { tsCode: { in: codes } },
      select: {
        tsCode: true,
        name: true,
        indexCode: true,
        listDate: true,
        delistDate: true,
        listStatus: true,
      },
    }),
    database.etfDaily.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: codes }, tradeDate: { lte: coverageThrough } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    database.etfAdjFactor.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: codes }, tradeDate: { lte: coverageThrough } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    database.etfShareSize.groupBy({
      by: ['tsCode'],
      where: { tsCode: { in: codes }, tradeDate: { lte: coverageThrough } },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    }),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: expectedHistoryStart, lte: coverageThrough },
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    }),
    database.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { lte: coverageThrough } },
      orderBy: { calDate: 'desc' },
      take: 252,
      select: { calDate: true },
    }),
  ]);
  const trailingStart = trailingDates.at(-1)?.calDate ?? coverageThrough;
  const [amountRows, latestShareSizeRows] = await Promise.all([
    database.etfDaily.findMany({
      where: {
        tsCode: { in: codes },
        tradeDate: { gte: trailingStart, lte: coverageThrough },
      },
      select: { tsCode: true, amount: true },
    }),
    database.etfShareSize.findMany({
      where: { tsCode: { in: codes }, tradeDate: { lte: coverageThrough } },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'desc' }],
      distinct: ['tsCode'],
      select: { tsCode: true, totalShare: true, totalSize: true },
    }),
  ]);

  const metadataByCode = new Map(metadata.map((row) => [row.tsCode, row]));
  const dailyByCode = new Map(dailyCoverage.map((row) => [row.tsCode, row]));
  const adjustmentByCode = new Map(adjustmentCoverage.map((row) => [row.tsCode, row]));
  const shareSizeByCode = new Map(shareSizeCoverage.map((row) => [row.tsCode, row]));
  const latestShareSizeByCode = new Map(latestShareSizeRows.map((row) => [row.tsCode, row]));
  const amountsByCode = new Map<string, number[]>();
  for (const row of amountRows) {
    if (row.amount == null) {
      continue;
    }
    const amounts = amountsByCode.get(row.tsCode) ?? [];
    amounts.push(row.amount);
    amountsByCode.set(row.tsCode, amounts);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = codes.map((tsCode): EtfRegistryProductAudit => {
    const membership = etfResearchMembership(tsCode)!;
    const registry = ETF_RESEARCH_REGISTRY.find(
      (item) => item.exposureId === membership.exposureId,
    )!;
    const metadataRow = metadataByCode.get(tsCode);
    const daily = dailyByCode.get(tsCode);
    const adjustment = adjustmentByCode.get(tsCode);
    const shareSize = shareSizeByCode.get(tsCode);
    const latestShareSize = latestShareSizeByCode.get(tsCode);
    const minimumSourceDate = metadataRow?.listDate
      ? maximumDate(metadataRow.listDate, expectedHistoryStart)
      : null;
    const expectedStartDate = minimumSourceDate
      ? (historyDates.find((date) => date.calDate >= minimumSourceDate)?.calDate ?? null)
      : null;
    const benchmarkMatches = metadataRow?.indexCode === registry.benchmarkCode;
    const lifecycleMatches =
      metadataRow != null &&
      metadataRow.listDate != null &&
      metadataRow.listDate <= ETF_RESEARCH_SELECTION_AS_OF &&
      (metadataRow.delistDate == null || metadataRow.delistDate >= ETF_RESEARCH_SELECTION_AS_OF) &&
      metadataRow.listStatus === 'L';

    if (!metadataRow) {
      errors.push(`${tsCode}: metadata is missing`);
    } else {
      if (!benchmarkMatches) {
        errors.push(
          `${tsCode}: benchmark ${metadataRow.indexCode ?? 'null'} does not match registry ${registry.benchmarkCode}`,
        );
      }
      if (!lifecycleMatches) {
        errors.push(
          `${tsCode}: product was not listed and active on ${ETF_RESEARCH_SELECTION_AS_OF}`,
        );
      }
    }
    // A historical audit end can predate newer registry products. Those products are correctly
    // absent at that time; coverage becomes mandatory from their first SSE session onward.
    const listedByCoverageEnd =
      metadataRow?.listDate == null || metadataRow.listDate <= coverageThrough;
    if (listedByCoverageEnd) {
      validateCoverage(
        errors,
        warnings,
        tsCode,
        'daily',
        daily?._min.tradeDate,
        daily?._max.tradeDate,
        expectedStartDate,
        coverageThrough,
        true,
      );
      validateCoverage(
        errors,
        warnings,
        tsCode,
        'adjustment',
        adjustment?._min.tradeDate,
        adjustment?._max.tradeDate,
        expectedStartDate,
        coverageThrough,
        true,
      );
      validateCoverage(
        errors,
        warnings,
        tsCode,
        'share-size',
        shareSize?._min.tradeDate,
        shareSize?._max.tradeDate,
        expectedStartDate,
        coverageThrough,
        false,
      );
    }
    if (daily && adjustment && Math.abs(daily._count._all - adjustment._count._all) > 1) {
      warnings.push(
        `${tsCode}: daily/adjustment row counts differ by ${Math.abs(daily._count._all - adjustment._count._all)}`,
      );
    }

    const amounts = amountsByCode.get(tsCode) ?? [];
    return {
      tsCode,
      name: metadataRow?.name ?? null,
      membership,
      benchmarkMatches,
      lifecycleMatches,
      expectedStartDate,
      dailyRows: daily?._count._all ?? 0,
      dailyStartDate: daily?._min.tradeDate ?? null,
      dailyEndDate: daily?._max.tradeDate ?? null,
      adjustmentRows: adjustment?._count._all ?? 0,
      adjustmentStartDate: adjustment?._min.tradeDate ?? null,
      adjustmentEndDate: adjustment?._max.tradeDate ?? null,
      trailingMedianAmount: amounts.length === 0 ? null : median(amounts),
      shareSizeRows: shareSize?._count._all ?? 0,
      shareSizeStartDate: shareSize?._min.tradeDate ?? null,
      shareSizeEndDate: shareSize?._max.tradeDate ?? null,
      latestTotalShare: latestShareSize?.totalShare ?? null,
      latestTotalSize: latestShareSize?.totalSize ?? null,
    };
  });

  return {
    registryVersion: ETF_RESEARCH_REGISTRY[0].registryVersion,
    selectionAsOf: ETF_RESEARCH_SELECTION_AS_OF,
    expectedHistoryStart,
    coverageThrough,
    exposures: ETF_RESEARCH_REGISTRY.length,
    products: codes.length,
    errors,
    warnings,
    rows,
  };
}

async function latestRegistryAuditDate(database: Prisma): Promise<string> {
  const row = await database.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: ETF_RESEARCH_SELECTION_AS_OF } },
    orderBy: { calDate: 'desc' },
    select: { calDate: true },
  });
  if (!row) {
    throw new Error('TradeCal has no SSE session for the ETF registry audit');
  }
  return row.calDate;
}

function validateCoverage(
  errors: string[],
  warnings: string[],
  tsCode: string,
  label: string,
  observedStart: string | null | undefined,
  observedEnd: string | null | undefined,
  expectedStart: string | null,
  expectedEnd: string,
  requireStart: boolean,
): void {
  if (!observedStart || !observedEnd) {
    errors.push(`${tsCode}: ${label} coverage is missing`);
    return;
  }
  if (expectedStart && observedStart > expectedStart) {
    const issue = `${tsCode}: ${label} starts ${observedStart}, expected by ${expectedStart}`;
    if (requireStart) {
      errors.push(issue);
    } else {
      warnings.push(`${issue}; historical provider coverage is incomplete`);
    }
  }
  if (observedEnd < expectedEnd) {
    errors.push(`${tsCode}: ${label} ends ${observedEnd}, expected through ${expectedEnd}`);
  }
}

function maximumDate(left: string, right: string): string {
  return left > right ? left : right;
}
