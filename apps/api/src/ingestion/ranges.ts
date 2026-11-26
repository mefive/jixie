import { sourceCaptureStartedAt } from '#market/synchronization/execution.js';
import { calendarDay, localDate } from '#market/synchronization/date.js';
import type { IngestionUnit, IngestionRunPlan } from './schema.js';
import { unitKey } from './runs.js';

/** 连续子区间保持原业务语义，只有范围标识变化。 / Child windows preserve semantics and change only bounds. */
export function rangeUnit(unit: IngestionUnit, startDate: string, endDate: string): IngestionUnit {
  return {
    ...unit,
    startDate,
    endDate,
    fullHistory: false,
    period: `${unit.announcementRange ? 'ann_range' : 'range'}/${startDate}/${endDate}`,
  };
}

/**
 * 旧年/月收据按实际完整范围求并集；日历捕获当日及未来日期每轮刷新。
 *
 * Union complete legacy ranges; refresh capture-day and future calendar dates on every run.
 */
export function uncoveredRangeUnits(
  unit: IngestionUnit,
  receipts: readonly {
    dataset: string;
    scope: string;
    status: string;
    responseComplete: boolean;
    rejectedCount: number;
    rangeStart: string | null;
    sourceStart: string | null;
    rangeEnd: string | null;
    startedAt: Date;
    request?: unknown;
  }[],
): IngestionUnit[] {
  if (!unit.adaptiveRange || unit.refresh || unit.dataset === 'financial-statements') {
    return [unit];
  }
  const ranges = receipts
    .flatMap((receipt) => {
      const start = receipt.rangeStart || receipt.sourceStart;
      const end =
        receipt.dataset === 'calendar' && receipt.rangeEnd
          ? [
              receipt.rangeEnd,
              calendarDay(
                localDate(sourceCaptureStartedAt({ ...receipt, request: receipt.request })),
                -1,
              ),
            ].sort()[0]
          : receipt.rangeEnd;
      if (
        receipt.dataset !== unit.dataset ||
        receipt.scope !== unit.scope ||
        receipt.status !== 'succeeded' ||
        !receipt.responseComplete ||
        receipt.rejectedCount ||
        !start ||
        !end ||
        start > end
      ) {
        return [];
      }

      return [{ start, end }];
    })
    .sort((left, right) => left.start.localeCompare(right.start));
  const missing: IngestionUnit[] = [];
  let cursor = unit.startDate;
  for (const range of ranges) {
    if (range.end < cursor || range.start > unit.endDate) {
      continue;
    }
    if (range.start > cursor) {
      missing.push(rangeUnit(unit, cursor, calendarDay(range.start, -1)));
    }
    cursor = [cursor, calendarDay(range.end, 1)].sort().at(-1)!;
    if (cursor > unit.endDate) {
      break;
    }
  }
  if (cursor <= unit.endDate) {
    missing.push(rangeUnit(unit, cursor, unit.endDate));
  }

  return missing.length === 1 &&
    missing[0].startDate === unit.startDate &&
    missing[0].endDate === unit.endDate
    ? [unit]
    : missing;
}

/**
 * 将已冻结的区间收窄至收据尚未覆盖的缺口。
 *
 * Narrow a frozen range to gaps left by completed receipts.
 */
export function replaceRangeUnit(
  plan: IngestionRunPlan,
  unit: IngestionUnit,
  children: IngestionUnit[],
): IngestionRunPlan {
  const replace = (units: IngestionUnit[]) =>
    units.flatMap((entry) => (unitKey(entry) === unitKey(unit) ? children : [entry]));

  return {
    ...plan,
    referenceUnits: replace(plan.referenceUnits),
    ...(plan.selectionUnits ? { selectionUnits: replace(plan.selectionUnits) } : {}),
    ...(plan.plan ? { plan: { ...plan.plan, units: replace(plan.plan.units) } } : {}),
  };
}
