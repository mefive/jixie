import type { MaintenanceTrigger } from '../runs/state.js';

/**
 * 约束定时日更的截止日，23:00 前的延迟触发不得启动当日批次。
 * A delayed/persistent timer before 23:00 must not start the current trading day's batch.
 */
export function scheduledDailyUpperBound(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}${values.month}${values.day}`;
  if (Number(values.hour) >= 23) {
    return date;
  }
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) - 1))
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');
}

/**
 * 提供定时维护的日期与交易日历信息，供休市跳过规则判断。
 * Supply schedule dates and calendar state for closed-day skipping.
 */
export interface ScheduledClosedDayInput {
  trigger: MaintenanceTrigger;
  targetDate?: string;
  pendingDates: number;
  todayIsOpen: number | null;
}

/**
 * 只在交易日历明确标记休市时跳过定时维护；日历缺失不能视为休市。
 * A weekday systemd schedule cannot encode exchange holidays. Only a confirmed `isOpen = 0`
 * is safe to skip: `null` means calendar synchronization did not produce today's row and must
 * stay on the normal validation path. Pending dates always take precedence so holiday wake-ups
 * can repair downtime gaps.
 */
export function shouldSkipScheduledClosedDay(input: ScheduledClosedDayInput): boolean {
  return (
    input.trigger === 'timer' &&
    input.targetDate == null &&
    input.pendingDates === 0 &&
    input.todayIsOpen === 0
  );
}
