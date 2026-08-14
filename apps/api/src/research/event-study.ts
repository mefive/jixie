import type { PrismaClient } from '@prisma/client';
import type {
  EventStudyPlanSpecV1,
  EventStudyResultV1,
  ResearchDataInputFingerprintV1,
  ResearchDiagnosticV1,
  ResearchEventCoverageV1,
  ResearchEventStudyEventV1,
  ResearchSeriesCoverageV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { researchDataInputFingerprint } from './fingerprints.js';

const NORMAL_95_PERCENT_CRITICAL_VALUE = 1.959963984540054;

interface ReturnPoint {
  date: string;
  value: number;
}

interface RawEvent {
  id: string;
  tsCode: string;
  announcementDate: string;
  reportPeriod: string;
}

interface EventWindow {
  event: RawEvent;
  eventTradeDate: string;
  asset: ReturnPoint[];
  benchmark: ReturnPoint[];
}

export interface EventStudyExecution {
  result: EventStudyResultV1;
  coverage: [ResearchEventCoverageV1, ResearchSeriesCoverageV1];
  diagnostics: ResearchDiagnosticV1[];
  dataFingerprints: ResearchDataInputFingerprintV1[];
}

export async function executeEventStudy(
  plan: EventStudyPlanSpecV1,
  minimumObservations: number,
  database: PrismaClient = prisma,
): Promise<EventStudyExecution> {
  const [eventSet, benchmarkInput] = plan.inputs;
  const codes = [...new Set(eventSet.source.entities.map((entity) => entity.id))];
  const loadStart = shiftCalendarDays(plan.start, -120);
  const loadEnd = shiftCalendarDays(plan.end, 120);
  const [eventRows, calendar, benchmarkRows] = await Promise.all([
    database.dividend.findMany({
      where: {
        tsCode: { in: codes },
        annDate: { not: null },
        divProc: '预案',
      },
      select: { id: true, tsCode: true, annDate: true, endDate: true },
      orderBy: [{ tsCode: 'asc' }, { annDate: 'asc' }, { endDate: 'asc' }, { id: 'asc' }],
    }),
    database.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1 },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
    loadBenchmarkRows(database, benchmarkInput.source, loadStart, loadEnd),
  ]);
  const tradingDates = calendar.map((row) => row.calDate);
  const eventCandidates = firstAnnouncements(
    eventRows.flatMap((row) =>
      row.annDate
        ? [
            {
              id: row.id,
              tsCode: row.tsCode,
              announcementDate: row.annDate,
              reportPeriod: row.endDate,
            },
          ]
        : [],
    ),
  ).filter((event) => event.announcementDate >= plan.start && event.announcementDate <= plan.end);
  const benchmarkByDate = simpleReturns(benchmarkRows);
  const windows: EventWindow[] = [];
  let eventsWithTradingDate = 0;
  let eventsWithCompleteWindow = 0;

  const eventsByCode = new Map<string, RawEvent[]>();
  for (const event of eventCandidates) {
    const list = eventsByCode.get(event.tsCode) ?? [];
    list.push(event);
    eventsByCode.set(event.tsCode, list);
  }
  const dailyRows = await database.daily.findMany({
    where: { tsCode: { in: codes }, tradeDate: { gte: loadStart, lte: loadEnd } },
    select: { tsCode: true, tradeDate: true, close: true },
    orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
  });
  const adjustmentRows = await database.adjFactor.findMany({
    where: { tsCode: { in: codes }, tradeDate: { gte: loadStart, lte: loadEnd } },
    select: { tsCode: true, tradeDate: true, adjFactor: true },
  });
  const adjustmentByKey = new Map(
    adjustmentRows.map((row) => [`${row.tsCode}|${row.tradeDate}`, row.adjFactor]),
  );
  const assetReturnsByCode = new Map<string, Map<string, number>>();
  for (const code of codes) {
    const adjusted = dailyRows
      .filter((row) => row.tsCode === code && row.close != null)
      .flatMap((row) => {
        const factor = adjustmentByKey.get(`${row.tsCode}|${row.tradeDate}`);
        return factor == null ? [] : [{ date: row.tradeDate, value: row.close! * factor }];
      });
    assetReturnsByCode.set(code, simpleReturns(adjusted));
  }

  for (const event of eventCandidates) {
    const eventIndex = tradingDates.findIndex((date) => date >= event.announcementDate);
    if (eventIndex < 0) {
      continue;
    }
    eventsWithTradingDate += 1;
    const startIndex = eventIndex + plan.protocol.eventWindow.start;
    const endIndex = eventIndex + plan.protocol.eventWindow.end;
    if (startIndex < 0 || endIndex >= tradingDates.length) {
      continue;
    }
    const windowDates = tradingDates.slice(startIndex, endIndex + 1);
    const assetByDate = assetReturnsByCode.get(event.tsCode)!;
    const asset = windowDates.flatMap((date) => {
      const value = assetByDate.get(date);
      return value == null ? [] : [{ date, value }];
    });
    const benchmark = windowDates.flatMap((date) => {
      const value = benchmarkByDate.get(date);
      return value == null ? [] : [{ date, value }];
    });
    if (asset.length !== windowDates.length || benchmark.length !== windowDates.length) {
      continue;
    }
    eventsWithCompleteWindow += 1;
    windows.push({ event, eventTradeDate: tradingDates[eventIndex]!, asset, benchmark });
  }

  const kept = removeOverlappingWindows(windows);
  if (kept.length < minimumObservations) {
    throw new Error(
      `event_study requires at least ${minimumObservations} complete non-overlapping events; received ${kept.length}`,
    );
  }
  const offsets = Array.from(
    { length: plan.protocol.eventWindow.end - plan.protocol.eventWindow.start + 1 },
    (_, index) => plan.protocol.eventWindow.start + index,
  );
  const abnormalByEvent = kept.map((window) =>
    window.asset.map((point, index) => point.value - window.benchmark[index]!.value),
  );
  const cars = abnormalByEvent.map((values) => values.reduce((sum, value) => sum + value, 0));
  const meanCar = average(cars);
  const standardDeviation = sampleStandardDeviation(cars);
  const eventTradeDates = kept.map((window) => window.eventTradeDate);
  const eventDateClusters = new Set(eventTradeDates).size;
  if (eventDateClusters < minimumObservations) {
    throw new Error(
      `event_study requires at least ${minimumObservations} distinct event trading dates for clustered inference; received ${eventDateClusters}`,
    );
  }
  const standardError = clusteredMeanStandardError(cars, eventTradeDates);
  if (!Number.isFinite(standardError) || standardError === 0) {
    throw new Error('event_study requires non-zero cross-event variation');
  }
  const criticalValue = studentTCritical95(eventDateClusters - 1);
  const path = offsets.map((relativeDay, index) => {
    const eventCars = abnormalByEvent.map((values) =>
      values.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
    );
    const cumulativeAverageAbnormalReturn = average(eventCars);
    const pathError = clusteredMeanStandardError(eventCars, eventTradeDates);
    return {
      relativeDay,
      observations: eventCars.length,
      averageAbnormalReturn: average(abnormalByEvent.map((values) => values[index]!)),
      cumulativeAverageAbnormalReturn,
      cumulativeConfidenceInterval95: {
        lower: cumulativeAverageAbnormalReturn - criticalValue * pathError,
        upper: cumulativeAverageAbnormalReturn + criticalValue * pathError,
      },
    };
  });
  const events: ResearchEventStudyEventV1[] = kept.map((window, index) => ({
    id: window.event.id,
    entity: { assetType: 'stock', id: window.event.tsCode },
    announcementDate: window.event.announcementDate,
    eventTradeDate: window.eventTradeDate,
    reportPeriod: window.event.reportPeriod,
    cumulativeAbnormalReturn: cars[index]!,
  }));
  const winsorizedCars = winsorize(cars, 0.05);
  const diagnostics: ResearchDiagnosticV1[] = [];
  if (kept.length < 20 || eventDateClusters < 20) {
    diagnostics.push({
      code: 'event_study_small_sample',
      severity: 'warning',
      messageZh: `事件研究有 ${kept.length} 个有效非重叠事件、${eventDateClusters} 个事件日簇，聚类区间可能较宽。`,
      messageEn: `The event study has ${kept.length} valid non-overlapping events across ${eventDateClusters} event-date clusters, so clustered intervals may be wide.`,
    });
  }
  const aggregate = {
    meanCumulativeAbnormalReturn: meanCar,
    medianCumulativeAbnormalReturn: quantile(
      [...cars].sort((a, b) => a - b),
      0.5,
    ),
    standardDeviation,
    standardError,
    eventDateClusters,
    tStatistic: meanCar / standardError,
    confidenceInterval95: {
      lower: meanCar - criticalValue * standardError,
      upper: meanCar + criticalValue * standardError,
    },
    positiveFraction: cars.filter((value) => value > 0).length / cars.length,
    winsorizedMeanCumulativeAbnormalReturn: average(winsorizedCars),
  };
  const eventDates = kept.map((window) => window.eventTradeDate).sort();
  const benchmarkDates = kept
    .flatMap((window) => window.benchmark.map((point) => point.date))
    .sort();
  return {
    result: {
      kind: 'event_study',
      version: 1,
      observations: kept.length,
      eventWindow: plan.protocol.eventWindow,
      returnModel: 'market_adjusted',
      events,
      path,
      aggregate,
    },
    coverage: [
      {
        inputId: eventSet.id,
        entitiesRequested: codes.length,
        eventsLoaded: eventCandidates.length,
        eventsWithTradingDate,
        eventsWithCompleteWindow,
        overlappingEventsExcluded: windows.length - kept.length,
        eventsAnalyzed: kept.length,
        firstEventDate: eventDates[0] ?? null,
        lastEventDate: eventDates.at(-1) ?? null,
      },
      {
        inputId: benchmarkInput.id,
        observationsLoaded: benchmarkByDate.size,
        observationsAligned: kept.length * offsets.length,
        firstDate: benchmarkRows[0]?.date ?? null,
        lastDate: benchmarkRows.at(-1)?.date ?? null,
        missingAfterAlignment: 0,
      },
    ],
    diagnostics,
    dataFingerprints: [
      researchDataInputFingerprint({
        inputId: eventSet.id,
        payload: kept.map((window) => ({
          event: window.event,
          eventTradeDate: window.eventTradeDate,
          asset: window.asset,
        })),
        observations: kept.length,
        firstDate: eventDates[0] ?? null,
        lastDate: eventDates.at(-1) ?? null,
      }),
      researchDataInputFingerprint({
        inputId: benchmarkInput.id,
        payload: kept.map((window) => ({
          eventId: window.event.id,
          benchmark: window.benchmark,
        })),
        observations: kept.length * offsets.length,
        firstDate: benchmarkDates[0] ?? null,
        lastDate: benchmarkDates.at(-1) ?? null,
      }),
    ],
  };
}

function firstAnnouncements(events: RawEvent[]): RawEvent[] {
  const first = new Map<string, RawEvent>();
  for (const event of events) {
    const key = `${event.tsCode}|${event.reportPeriod}`;
    if (!first.has(key)) {
      first.set(key, event);
    }
  }
  return [...first.values()];
}

function removeOverlappingWindows(windows: EventWindow[]): EventWindow[] {
  const sorted = [...windows].sort(
    (left, right) =>
      left.event.tsCode.localeCompare(right.event.tsCode) ||
      left.eventTradeDate.localeCompare(right.eventTradeDate),
  );
  const kept: EventWindow[] = [];
  const lastWindowEndByCode = new Map<string, string>();
  for (const window of sorted) {
    const priorEnd = lastWindowEndByCode.get(window.event.tsCode);
    const windowStart = window.asset[0]!.date;
    if (priorEnd && windowStart <= priorEnd) {
      continue;
    }
    kept.push(window);
    lastWindowEndByCode.set(window.event.tsCode, window.asset.at(-1)!.date);
  }
  return kept;
}

async function loadBenchmarkRows(
  database: PrismaClient,
  source: EventStudyPlanSpecV1['inputs'][1]['source'],
  start: string,
  end: string,
): Promise<ReturnPoint[]> {
  if (source.kind !== 'instrument') {
    throw new Error('event-study benchmark must be an instrument');
  }
  if (source.assetType === 'index') {
    const rows = await database.indexDaily.findMany({
      where: { tsCode: source.id, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    });
    return rows.map((row) => ({ date: row.tradeDate, value: row.close }));
  }
  const rows = await database.etfDaily.findMany({
    where: { tsCode: source.id, tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, close: true },
    orderBy: { tradeDate: 'asc' },
  });
  const adjustments = await database.etfAdjFactor.findMany({
    where: { tsCode: source.id, tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, adjFactor: true },
  });
  const adjustmentByDate = new Map(adjustments.map((row) => [row.tradeDate, row.adjFactor]));
  return rows.flatMap((row) => {
    const adjustment = adjustmentByDate.get(row.tradeDate);
    return row.close == null || adjustment == null
      ? []
      : [{ date: row.tradeDate, value: row.close * adjustment }];
  });
}

function simpleReturns(prices: ReturnPoint[]): Map<string, number> {
  const sorted = [...prices].sort((left, right) => left.date.localeCompare(right.date));
  const returns = new Map<string, number>();
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!.value;
    if (previous !== 0) {
      returns.set(sorted[index]!.date, sorted[index]!.value / previous - 1);
    }
  }
  return returns;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]): number {
  const mean = average(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1),
  );
}

function clusteredMeanStandardError(values: number[], groups: string[]): number {
  if (values.length !== groups.length) {
    throw new Error('clustered standard error requires one group per observation');
  }
  const mean = average(values);
  const residualSumByGroup = new Map<string, number>();
  for (let index = 0; index < values.length; index += 1) {
    const group = groups[index]!;
    residualSumByGroup.set(group, (residualSumByGroup.get(group) ?? 0) + values[index]! - mean);
  }
  const clusterCount = residualSumByGroup.size;
  if (clusterCount < 2) {
    return Number.NaN;
  }
  const meat = [...residualSumByGroup.values()].reduce((sum, residual) => sum + residual ** 2, 0);
  return Math.sqrt((clusterCount / (clusterCount - 1)) * (meat / values.length ** 2));
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function winsorize(values: number[], tailFraction: number): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const lower = quantile(sorted, tailFraction);
  const upper = quantile(sorted, 1 - tailFraction);
  return values.map((value) => Math.max(lower, Math.min(upper, value)));
}

function studentTCritical95(degreesOfFreedom: number): number {
  const z = NORMAL_95_PERCENT_CRITICAL_VALUE;
  const inverse = 1 / degreesOfFreedom;
  return (
    z + ((z ** 3 + z) * inverse) / 4 + ((5 * z ** 5 + 16 * z ** 3 + 3 * z) * inverse ** 2) / 96
  );
}

function shiftCalendarDays(value: string, days: number): string {
  const date = new Date(
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))),
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}
