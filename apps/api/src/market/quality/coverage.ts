import { median } from '#math/stats.js';
import { appendDateList, formatNumber } from './format.js';
import type { AuditFinding, AuditStatus } from './report.js';

/**
 * 记录单日期行数，供稠密覆盖检查。
 *
 * Supply date counts for dense-coverage checks.
 */
export interface DateCount {
  tradeDate: string;
  count: number;
}

/**
 * 对比预期交易日与实际数据，定位缺失和多余日期。
 *
 * Describe expected and observed dates for calendar coverage analysis.
 */
export interface CalendarCoverage {
  observedStart: string | null;
  observedEnd: string | null;
  leadingMissingDates: string[];
  internalMissingDates: string[];
  trailingMissingDates: string[];
  sharpDropDates: Array<{ tradeDate: string; count: number; referenceMedian: number }>;
  minimumRows: number;
  medianRows: number;
  maximumRows: number;
}

/**
 * 按交易日历检查数据日期覆盖，区分缺口与合法休市。
 *
 * Analyze stored dates against the trading calendar to distinguish gaps from closed days.
 */
export function analyzeCalendarCoverage(
  openDates: string[],
  dateCounts: DateCount[],
): CalendarCoverage {
  const sortedCounts = [...dateCounts].sort((left, right) =>
    left.tradeDate.localeCompare(right.tradeDate),
  );
  const observedStart = sortedCounts[0]?.tradeDate ?? null;
  const observedEnd = sortedCounts.at(-1)?.tradeDate ?? null;
  const countByDate = new Map(sortedCounts.map((row) => [row.tradeDate, row.count]));
  const leadingMissingDates: string[] = [];
  const internalMissingDates: string[] = [];
  const trailingMissingDates: string[] = [];

  for (const date of openDates) {
    if (countByDate.has(date)) {
      continue;
    }
    if (!observedStart || date < observedStart) {
      leadingMissingDates.push(date);
    } else if (observedEnd && date > observedEnd) {
      trailingMissingDates.push(date);
    } else {
      internalMissingDates.push(date);
    }
  }

  const rowCounts = sortedCounts.map((row) => row.count);
  return {
    observedStart,
    observedEnd,
    leadingMissingDates,
    internalMissingDates,
    trailingMissingDates,
    sharpDropDates: findSharpRowCountDrops(sortedCounts),
    minimumRows: rowCounts.length > 0 ? Math.min(...rowCounts) : 0,
    medianRows: median(rowCounts),
    maximumRows: rowCounts.length > 0 ? Math.max(...rowCounts) : 0,
  };
}

/**
 * 识别相邻日期记录量骤降，供稠密数据质量预警。
 *
 * Detect sharp dated row-count drops in dense datasets.
 */
export function findSharpRowCountDrops(
  dateCounts: DateCount[],
  lookback = 20,
  minimumFraction = 0.7,
): Array<{ tradeDate: string; count: number; referenceMedian: number }> {
  const drops: Array<{ tradeDate: string; count: number; referenceMedian: number }> = [];
  for (let index = lookback; index < dateCounts.length; index++) {
    const referenceMedian = median(
      dateCounts.slice(index - lookback, index).map((row) => row.count),
    );
    if (referenceMedian > 0 && dateCounts[index].count < referenceMedian * minimumFraction) {
      drops.push({
        tradeDate: dateCounts[index].tradeDate,
        count: dateCounts[index].count,
        referenceMedian,
      });
    }
  }
  return drops;
}

/**
 * 将稠密数据集覆盖检查转换为统一审计发现。
 *
 * Convert dense dataset coverage checks into a standardized audit finding.
 */
export function buildDenseCoverageFinding(
  id: string,
  title: string,
  openDates: string[],
  dateCounts: DateCount[],
): AuditFinding {
  const coverage = analyzeCalendarCoverage(openDates, dateCounts);
  const hasInternalGap = coverage.internalMissingDates.length > 0;
  const hasBoundaryGap =
    coverage.leadingMissingDates.length > 0 || coverage.trailingMissingDates.length > 0;
  const hasSharpDrop = coverage.sharpDropDates.length > 0;
  const status: AuditStatus = hasInternalGap
    ? 'error'
    : hasBoundaryGap || hasSharpDrop
      ? 'warn'
      : 'pass';
  const details = [
    `Observed ${coverage.observedStart ?? 'n/a'}..${coverage.observedEnd ?? 'n/a'}; rows/day min ${coverage.minimumRows}, median ${formatNumber(coverage.medianRows)}, max ${coverage.maximumRows}.`,
  ];
  appendDateList(details, 'Leading uncovered open days', coverage.leadingMissingDates);
  appendDateList(details, 'Internal missing open days', coverage.internalMissingDates);
  appendDateList(details, 'Trailing uncovered open days', coverage.trailingMissingDates);
  if (hasSharpDrop) {
    details.push(
      `Sharp row-count drops: ${coverage.sharpDropDates.length} (${coverage.sharpDropDates
        .slice(0, 8)
        .map(
          (row) =>
            `${row.tradeDate}=${row.count} vs prior median ${formatNumber(row.referenceMedian)}`,
        )
        .join(', ')}${coverage.sharpDropDates.length > 8 ? ', …' : ''}).`,
    );
  }

  return {
    id: `calendar-${id}`,
    title: `${title}: calendar coverage`,
    status,
    summary:
      status === 'pass'
        ? `${dateCounts.length} open dates are continuous`
        : `${coverage.leadingMissingDates.length} leading, ${coverage.internalMissingDates.length} internal, ${coverage.trailingMissingDates.length} trailing gaps; ${coverage.sharpDropDates.length} sharp drops`,
    details,
  };
}
