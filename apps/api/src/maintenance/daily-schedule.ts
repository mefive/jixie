import type { MaintenanceTrigger } from './state.js';

export interface ScheduledClosedDayInput {
  trigger: MaintenanceTrigger;
  targetDate?: string;
  pendingDates: number;
  todayIsOpen: number | null;
}

/**
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
