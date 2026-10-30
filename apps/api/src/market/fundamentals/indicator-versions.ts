import { getDatabase } from '#infra/database/prisma.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { sameValues } from '../synchronization/rows.js';
import { mergeIndicatorSnapshot, selectIndicatorSnapshots } from './indicator-selection.js';

export interface IndicatorVersionsInput {
  tsCode?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * 公开日期与当前版本可得日期不同；最新值回填只能从实际捕获时点使用。
 *
 * Announcement and current-version availability differ; latest-only backfills are usable only from
 * capture time.
 */
export async function loadIndicatorVersions(input: IndicatorVersionsInput = {}) {
  const rows = await getDatabase().finaIndicatorVersion.findMany({
    where: {
      availabilityQuality: { not: 'unknown' },
      ...(input.tsCode ? { tsCode: canonicalStockCode(input.tsCode) } : {}),
      ...(input.endDate ? { availableDate: { lte: input.endDate } } : {}),
    },
    orderBy: [
      { availableDate: 'asc' },
      { observedAt: 'asc' },
      { annDate: 'asc' },
      { endDate: 'asc' },
    ],
  });
  const captures = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.availableDate}|${row.observedAt.toISOString()}`;
    const capture = captures.get(key) ?? [];
    capture.push(row);
    captures.set(key, capture);
  }

  // 先纳入查询起点以前的选择状态，再过滤输出，避免旧来源在窄查询中重新获选。
  // Establish selection before the query start so narrow ranges cannot reselect an older source.
  const current = new Map<string, (typeof rows)[number]>();
  const events = new Map<string, (typeof rows)[number]>();
  for (const capture of captures.values()) {
    const sources = new Map(
      capture.map((row) => [
        JSON.stringify([row.tsCode, row.endDate, row.sourceTsCode ?? null, row.updateFlag === '1']),
        row,
      ]),
    );
    const selected = selectIndicatorSnapshots(capture.map((values) => ({ values })));
    for (const record of selected.records) {
      const key = `${record.values.tsCode}/${record.values.endDate}`;
      const previous = current.get(key);
      let values;
      try {
        values = mergeIndicatorSnapshot(previous, record);
      } catch {
        // 来源版本仍可审计；未被接纳的修订不进入研究和回测输入。
        // Retained source versions remain auditable; unaccepted revisions are not consumer inputs.
        continue;
      }
      if (previous && sameValues(previous, values)) {
        continue;
      }
      const sourceKey = JSON.stringify([
        values.tsCode,
        values.endDate,
        values.sourceTsCode,
        record.authoritativeRevision,
      ]);
      const source = sources.get(sourceKey)!;
      const event = { ...source, ...values };
      current.set(key, event);
      if (!input.startDate || event.availableDate >= input.startDate) {
        events.set(`${event.availableDate}|${key}`, event);
      }
    }
  }

  return [...events.values()].sort(
    (left, right) =>
      left.availableDate.localeCompare(right.availableDate) ||
      (left.annDate ?? '').localeCompare(right.annDate ?? '') ||
      left.endDate.localeCompare(right.endDate) ||
      left.observedAt.getTime() - right.observedAt.getTime(),
  );
}
