import { createHash } from 'node:crypto';
import type { TushareRow } from '../../src/market/providers/tushare/client.js';

export type MainBusinessDimension = 'P' | 'D' | 'I';

export interface MainBusinessProbeClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

export interface MainBusinessProbeCase {
  tsCode: string;
  period: string;
  type: MainBusinessDimension;
}

export interface MainBusinessProbeObservation extends MainBusinessProbeCase {
  rowCount: number;
  fields: string[];
  itemNames: string[];
  currencies: string[];
  missingCurrencyRows: number;
  nullSalesRows: number;
  nullProfitRows: number;
  nullCostRows: number;
  duplicateRows: number;
  conflictingItemRows: number;
  announcementDatesPresent: boolean;
  versionIdentifiersPresent: boolean;
  responseFingerprint: string;
  sourceRows: readonly TushareRow[];
}

export interface MainBusinessProbeReport {
  observations: MainBusinessProbeObservation[];
  itemNamesUnchangedAcrossPeriods: boolean;
  publicDecision: 'reject_pit_sdk';
  blockingReasons: string[];
}

export const DEFAULT_MAIN_BUSINESS_PROBE_CASES: readonly MainBusinessProbeCase[] = [
  ...cases('000858.SZ', ['20241231', '20251231']),
  ...cases('000333.SZ', ['20241231', '20251231']),
  ...cases('300750.SZ', ['20241231', '20251231']),
];

/** Snapshot bounded source responses for an audit, never as a production dataset. */
export async function probeMainBusinessSegments(
  client: MainBusinessProbeClient,
  probeCases: readonly MainBusinessProbeCase[] = DEFAULT_MAIN_BUSINESS_PROBE_CASES,
): Promise<MainBusinessProbeReport> {
  const observations: MainBusinessProbeObservation[] = [];
  for (const probeCase of probeCases) {
    const rows = await client.call('fina_mainbz', {
      ts_code: probeCase.tsCode,
      period: probeCase.period,
      type: probeCase.type,
    });
    observations.push(summarizeMainBusinessRows(probeCase, rows));
  }
  return assessMainBusinessObservations(observations);
}

export function summarizeMainBusinessRows(
  probeCase: MainBusinessProbeCase,
  rows: readonly TushareRow[],
): MainBusinessProbeObservation {
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const serializedRows = rows.map((row) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
    ),
  );
  const itemVersions = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    const identity = JSON.stringify([row.bz_code || null, row.bz_item, row.curr_type]);
    const versions = itemVersions.get(identity) ?? new Set<string>();
    versions.add(serializedRows[index]);
    itemVersions.set(identity, versions);
  });

  return {
    ...probeCase,
    rowCount: rows.length,
    fields,
    itemNames: uniqueStrings(rows.map((row) => row.bz_item)),
    currencies: uniqueStrings(rows.map((row) => row.curr_type)),
    missingCurrencyRows: rows.filter((row) => !row.curr_type).length,
    nullSalesRows: rows.filter((row) => finiteNumber(row.bz_sales) === null).length,
    nullProfitRows: rows.filter((row) => finiteNumber(row.bz_profit) === null).length,
    nullCostRows: rows.filter((row) => finiteNumber(row.bz_cost) === null).length,
    duplicateRows: rows.length - new Set(serializedRows).size,
    conflictingItemRows: [...itemVersions.values()].reduce(
      (total, versions) => total + Math.max(0, versions.size - 1),
      0,
    ),
    announcementDatesPresent:
      rows.length > 0 &&
      rows.every((row) =>
        ['ann_date', 'f_ann_date'].some(
          (field) => typeof row[field] === 'string' && /^\d{8}$/.test(row[field]),
        ),
      ),
    versionIdentifiersPresent: rows.length > 0 && rows.every((row) => Boolean(row.version_id)),
    responseFingerprint: createHash('sha256')
      .update(JSON.stringify(serializedRows.sort()))
      .digest('hex'),
    sourceRows: rows,
  };
}

export function assessMainBusinessObservations(
  observations: readonly MainBusinessProbeObservation[],
): MainBusinessProbeReport {
  const itemNamesUnchangedAcrossPeriods = itemNamesAreUnchanged(observations);
  // Presence of a date or unchanged labels cannot establish revision history or
  // non-overlapping segment membership. Those require independent source evidence.
  const blockingReasons = [
    'historical_revision_availability_unverified',
    'segment_hierarchy_and_units_require_source_reconciliation',
    ...(!observations.length || observations.some((item) => !item.rowCount)
      ? ['empty_source_sample']
      : []),
    ...(observations.some((item) => !item.announcementDatesPresent)
      ? ['missing_announcement_dates']
      : []),
    ...(observations.some((item) => !item.versionIdentifiersPresent)
      ? ['missing_version_identifiers']
      : []),
    ...(!itemNamesUnchangedAcrossPeriods ? ['item_names_changed_or_history_insufficient'] : []),
    ...(observations.some((item) => item.missingCurrencyRows || item.currencies.length !== 1)
      ? ['currency_requires_reconciliation']
      : []),
    ...(observations.some((item) => item.nullSalesRows || item.nullCostRows || item.nullProfitRows)
      ? ['incomplete_financial_fields']
      : []),
    ...(observations.some((item) => item.duplicateRows || item.conflictingItemRows)
      ? ['duplicate_or_conflicting_items']
      : []),
  ];

  return {
    observations: [...observations],
    itemNamesUnchangedAcrossPeriods,
    publicDecision: 'reject_pit_sdk',
    blockingReasons,
  };
}

function cases(tsCode: string, periods: readonly string[]): MainBusinessProbeCase[] {
  return periods.flatMap((period) =>
    (['P', 'D', 'I'] as const).map((type) => ({ tsCode, period, type })),
  );
}

function itemNamesAreUnchanged(observations: readonly MainBusinessProbeObservation[]): boolean {
  const groups = new Map<string, MainBusinessProbeObservation[]>();
  for (const observation of observations) {
    const key = `${observation.tsCode}:${observation.type}`;
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  return (
    groups.size > 0 &&
    [...groups.values()].every((group) => {
      if (
        new Set(group.map((item) => item.period)).size < 2 ||
        group.some((item) => !item.rowCount)
      ) {
        return false;
      }
      const identities = group.map((observation) => JSON.stringify(observation.itemNames));
      return new Set(identities).size === 1;
    })
  );
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter(
          (value): value is string | number =>
            (typeof value === 'string' && value.trim() !== '') || typeof value === 'number',
        )
        .map(String),
    ),
  ].sort();
}
