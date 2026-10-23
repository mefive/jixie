import { getDatabase } from '#infra/database/prisma.js';
import { calendarDay, localDate } from '../synchronization/date.js';
import type {
  MarketPartition,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import { fetchSourcePages, type SyncSource } from '../synchronization/source.js';
import {
  CHINA_MACRO_SERIES,
  chinaMacroSourceRequests,
  macroVintageKind,
  parseMacroScheduleRows,
  prepareMacroObservations,
  type PreparedMacroObservation,
} from './china-macro.js';
import {
  parseUsHeadlineCpiRows,
  prepareUsHeadlineCpiObservations,
  US_HEADLINE_CPI_BLS_SERIES_ID,
  US_HEADLINE_CPI_SERIES,
  type BlsPublicDataClientLike,
} from './us-headline-cpi.js';

/**
 * 观察期间、来源发布日、抓取 vintage 分开保留，不能把回填标为实时历史。
 *
 * Keep observation periods, release dates and capture vintages distinct; backfills are not
 * real-time history.
 */
export async function prepareMacroPartition(
  source: SyncSource,
  cpi: BlsPublicDataClientLike,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const startMonth = partition.startDate.slice(0, 6);
  const endMonth = partition.endDate.slice(0, 6);
  const vintageDate = localDate(fetchedAt);
  const calendar = await getDatabase().tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gte: partition.startDate, lte: calendarDay(partition.endDate, 90) },
    },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const openDates = calendar.map((entry) => entry.calDate);
  const result: PreparedMarketPartition = {
    tables: [],
    status: 'complete',
    evidence: { vintageDate },
    observedDates: [],
    gaps: [],
    errors: [],
  };
  const prepared: PreparedMacroObservation[] = [];
  if (partition.dataset === 'us-cpi') {
    const rows = await cpi.loadSeries(
      US_HEADLINE_CPI_BLS_SERIES_ID,
      Number(startMonth.slice(0, 4)),
      Number(endMonth.slice(0, 4)),
    );
    const parsed = parseUsHeadlineCpiRows(rows, startMonth, endMonth);
    prepared.push(...prepareUsHeadlineCpiObservations(parsed, openDates));
    result.tables.push({
      table: 'MacroSeries',
      records: [{ values: { ...US_HEADLINE_CPI_SERIES } }],
    });
  } else {
    const schedules = [];
    // 发布日程只作为证据；较老资料没有日程时仍保持既有保守滞后口径。
    // Schedules are evidence only; older periods retain the existing conservative-lag policy.
    if (endMonth >= '202601') {
      for (
        let month = Math.max(Number(startMonth.slice(4)), 1);
        month <= Number(endMonth.slice(4));
        month++
      ) {
        const calendarMonth = `${startMonth.slice(0, 4)}${String(month).padStart(2, '0')}`;
        const pages = await fetchSourcePages(
          source,
          'cn_schedule',
          { m: calendarMonth },
          'publish_date,title,month,issuing_org,data_api',
        );
        result.errors.push(...pages.errors);
        schedules.push(...parseMacroScheduleRows(pages.rows));
      }
    }
    for (const request of chinaMacroSourceRequests(startMonth, endMonth).filter(
      (request) => request.sourceApi === partition.scope,
    )) {
      const pages = await fetchSourcePages(
        source,
        request.sourceApi,
        request.params,
        request.fields ?? '',
      );
      result.errors.push(...pages.errors);
      for (const definition of CHINA_MACRO_SERIES.filter(
        (entry) => entry.sourceApi === request.sourceApi,
      )) {
        for (const row of pages.rows) {
          try {
            prepared.push(...prepareMacroObservations(definition, [row], schedules, openDates));
          } catch (error) {
            result.errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        const { fallbackLagDays: _lag, ...catalog } = definition;
        result.tables.push({ table: 'MacroSeries', records: [{ values: catalog }] });
      }
    }
    result.tables.push({
      table: 'MacroReleaseSchedule',
      records: schedules.map((schedule) => ({ values: { ...schedule, retrievedAt: fetchedAt } })),
    });
  }
  const existing = await getDatabase().macroObservation.findMany({
    where: {
      seriesKey: { in: [...new Set(prepared.map((row) => row.seriesKey))] },
      period: { gte: startMonth, lte: partition.endDate },
    },
    orderBy: { vintageDate: 'desc' },
  });
  const latest = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = `${row.seriesKey}|${row.period}`;
    if (!latest.has(key)) {
      latest.set(key, row);
    }
  }
  const definitions =
    partition.dataset === 'us-cpi'
      ? [{ seriesKey: US_HEADLINE_CPI_SERIES.seriesKey, frequency: 'monthly', fallbackLagDays: 20 }]
      : CHINA_MACRO_SERIES.filter((definition) => definition.sourceApi === partition.scope);
  for (const definition of definitions) {
    if (definition.frequency !== 'monthly') {
      continue;
    }
    for (let month = Number(startMonth.slice(4)); month <= Number(endMonth.slice(4)); month++) {
      const period = `${startMonth.slice(0, 4)}${String(month).padStart(2, '0')}`;
      const monthEnd = new Date(Date.UTC(Number(period.slice(0, 4)), month, 0))
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '');
      if (
        calendarDay(monthEnd, definition.fallbackLagDays + 1) <= vintageDate &&
        !prepared.some(
          (observation) =>
            observation.seriesKey === definition.seriesKey && observation.period === period,
        )
      ) {
        result.gaps.push(
          `${definition.seriesKey}/${period}: expected published observation is missing`,
        );
      }
    }
  }
  const records: SourceRecord[] = [];
  const seen = new Set<string>();
  for (const observation of prepared) {
    const key = `${observation.seriesKey}|${observation.period}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (observation.availableDate > vintageDate) {
      result.gaps.push(`${key}: release is not yet available (${observation.availableDate})`);
      continue;
    }
    result.observedDates.push(
      observation.period.length === 6 ? `${observation.period}01` : observation.period,
    );
    const current = latest.get(key);
    if (
      current &&
      current.value === observation.value &&
      current.availableDate === observation.availableDate &&
      current.releaseDate === observation.releaseDate &&
      current.availabilityKind === observation.availabilityKind
    ) {
      continue;
    }
    records.push({
      values: {
        ...observation,
        vintageDate,
        vintageKind: macroVintageKind(observation.availableDate, vintageDate),
        retrievedAt: fetchedAt,
      },
      publicationDate: observation.releaseDate,
      availableDate: observation.availableDate,
      availabilityQuality: 'latest_only',
    });
  }
  result.tables.push({ table: 'MacroObservation', records });
  if (!prepared.length) {
    result.errors.push(`${partition.dataset}/${partition.scope}: unexplained empty macro response`);
  }
  result.status = result.errors.length ? 'error' : result.gaps.length ? 'partial' : 'complete';

  return result;
}
