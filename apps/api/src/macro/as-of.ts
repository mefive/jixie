import type { Prisma } from '../lib/prisma.js';

export type MacroRevisionPolicy = 'as_available' | 'latest_vintage';

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

export interface MacroAsOfSnapshot {
  decisionDate: string;
  revisionPolicy: MacroRevisionPolicy;
  observations: MacroObservationVintageRow[];
  disclosure: {
    latestValueBackfillRows: number;
    futureVintageRows: number;
  };
}

export interface LoadMacroAsOfOptions {
  seriesKeys: string[];
  decisionDate: string;
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
}

export interface LoadMacroVintagesOptions {
  seriesKeys: string[];
  throughDate: string;
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
}

/** Loads one revision per series/period using an explicit real-time or latest-vintage policy. */
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

/** Loads a bounded vintage set once so a research window can evaluate many decision dates. */
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

/** Pure selection helper used by evaluators and future-function fixtures. */
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
