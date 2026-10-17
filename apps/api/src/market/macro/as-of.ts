import type { Prisma } from '#infra/database/prisma.js';

export type MacroRevisionPolicy = 'as_available' | 'latest_vintage';

/**
 * 保留宏观序列各抓取版本、期间与可得日期。
 * Retain macro capture vintages, periods and availability dates.
 */
export interface MacroObservationVintageRow {
  seriesKey: string;
  period: string;
  value: number;
  releaseDate: string | null;
  availableDate: string;
  availabilityKind: string;
  vintageDate: string;
  vintageKind: string;
}

/**
 * 封装按版本政策筛选后的历史可见宏观快照。
 * Collect an as-of macro snapshot selected under a declared vintage policy.
 */
export interface MacroAsOfSnapshot {
  decisionDate: string;
  revisionPolicy: MacroRevisionPolicy;
  observations: MacroObservationVintageRow[];
  disclosure: {
    latestValueBackfillRows: number;
    futureVintageRows: number;
  };
}

/**
 * 显式指定宏观读取日期、序列与修订政策。
 * Declare macro dates, series and revision policy for as-of reads.
 */
export interface LoadMacroAsOfOptions {
  seriesKeys: string[];
  decisionDate: string;
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
}

/**
 * 限定批量宏观版本读取窗口，供多决策日复用。
 * Bound vintage loading for reuse across decision dates.
 */
export interface LoadMacroVintagesOptions {
  seriesKeys: string[];
  throughDate: string;
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
}

/**
 * 按明确的实时或最新版本政策为每个序列与期间选择一个宏观版本。
 * Loads one revision per series/period using an explicit real-time or latest-vintage policy.
 */
export async function loadMacroObservationsAsOf(
  database: Prisma,
  options: LoadMacroAsOfOptions,
): Promise<MacroAsOfSnapshot> {
  assertOptions(options);
  const rows = await loadMacroVintagesThrough(database, {
    seriesKeys: options.seriesKeys,
    throughDate: options.decisionDate,
    revisionPolicy: options.revisionPolicy,
    dataCutoff: options.dataCutoff,
  });
  return selectMacroObservationsAsOf(rows, options);
}

/**
 * 一次读取有界版本集合，供研究窗口内多个决策日期重复评估。
 * Loads a bounded vintage set once so a research window can evaluate many decision dates.
 */
export async function loadMacroVintagesThrough(
  database: Prisma,
  options: LoadMacroVintagesOptions,
): Promise<MacroObservationVintageRow[]> {
  assertOptions({
    seriesKeys: options.seriesKeys,
    decisionDate: options.throughDate,
    revisionPolicy: options.revisionPolicy,
    dataCutoff: options.dataCutoff,
  });
  const vintageUpperBound =
    options.revisionPolicy === 'as_available'
      ? minimumDate(options.throughDate, options.dataCutoff)
      : (options.dataCutoff ?? undefined);
  return database.macroObservation.findMany({
    where: {
      seriesKey: { in: options.seriesKeys },
      availableDate: { lte: options.throughDate },
      ...(vintageUpperBound ? { vintageDate: { lte: vintageUpperBound } } : {}),
    },
    select: {
      seriesKey: true,
      period: true,
      value: true,
      releaseDate: true,
      availableDate: true,
      availabilityKind: true,
      vintageDate: true,
      vintageKind: true,
    },
    orderBy: [{ seriesKey: 'asc' }, { period: 'asc' }, { vintageDate: 'asc' }],
  });
}

/**
 * 纯函数选择指定日期可见宏观观测，供评估与未来信息检查复用。
 * Pure selection helper used by evaluators and future-function fixtures.
 */
export function selectMacroObservationsAsOf(
  rows: MacroObservationVintageRow[],
  options: Omit<LoadMacroAsOfOptions, 'seriesKeys'> & { seriesKeys?: string[] },
): MacroAsOfSnapshot {
  const seriesKeys = options.seriesKeys ?? [...new Set(rows.map((row) => row.seriesKey))];
  assertOptions({ ...options, seriesKeys });
  const requestedSeries = new Set(seriesKeys);
  const eligible = rows.filter((row) => {
    assertObservation(row);
    if (!requestedSeries.has(row.seriesKey) || row.availableDate > options.decisionDate) {
      return false;
    }
    if (options.dataCutoff && row.vintageDate > options.dataCutoff) {
      return false;
    }
    return options.revisionPolicy === 'latest_vintage' || row.vintageDate <= options.decisionDate;
  });
  const selected = new Map<string, MacroObservationVintageRow>();
  for (const row of eligible) {
    const key = `${row.seriesKey}|${row.period}`;
    const current = selected.get(key);
    if (!current || current.vintageDate < row.vintageDate) {
      selected.set(key, row);
    }
  }
  const observations = [...selected.values()].sort(
    (left, right) =>
      left.seriesKey.localeCompare(right.seriesKey) || left.period.localeCompare(right.period),
  );

  return {
    decisionDate: options.decisionDate,
    revisionPolicy: options.revisionPolicy,
    observations,
    disclosure: {
      latestValueBackfillRows: observations.filter(
        (row) => row.vintageKind === 'latest_value_backfill',
      ).length,
      futureVintageRows: observations.filter((row) => row.vintageDate > options.decisionDate)
        .length,
    },
  };
}

/**
 * 校验宏观读取的日期、版本政策与范围，避免隐含选择当前修订值。
 * Validate macro query dates, revision policy and bounds before vintage selection.
 */
function assertOptions(options: LoadMacroAsOfOptions): void {
  if (!isDate(options.decisionDate)) {
    throw new Error('Macro decisionDate must be YYYYMMDD.');
  }
  if (options.dataCutoff != null && !isDate(options.dataCutoff)) {
    throw new Error('Macro dataCutoff must be YYYYMMDD when provided.');
  }
  if (
    options.seriesKeys.length === 0 ||
    new Set(options.seriesKeys).size !== options.seriesKeys.length
  ) {
    throw new Error('Macro seriesKeys must be a non-empty unique list.');
  }
}

function assertObservation(row: MacroObservationVintageRow): void {
  if (
    !/^\d{6}(?:\d{2})?$/.test(row.period) ||
    !isDate(row.availableDate) ||
    !isDate(row.vintageDate) ||
    (row.releaseDate != null && !isDate(row.releaseDate)) ||
    (row.releaseDate != null && row.availableDate < row.releaseDate) ||
    row.vintageDate < row.availableDate ||
    !Number.isFinite(row.value)
  ) {
    throw new Error(`Invalid macro observation ${row.seriesKey} ${row.period} ${row.vintageDate}.`);
  }
}

function minimumDate(decisionDate: string, dataCutoff: string | null | undefined): string {
  return dataCutoff && dataCutoff < decisionDate ? dataCutoff : decisionDate;
}

function isDate(value: string): boolean {
  return /^\d{8}$/.test(value);
}
