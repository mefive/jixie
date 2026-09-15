import { describe, expect, it } from 'vitest';
import { shouldSkipScheduledClosedDay } from './daily-schedule.js';

describe('daily maintenance schedule', () => {
  it('skips a scheduled run when today is explicitly closed and no catch-up is pending', () => {
    expect(
      shouldSkipScheduledClosedDay({
        trigger: 'timer',
        pendingDates: 0,
        todayIsOpen: 0,
      }),
    ).toBe(true);
  });

  it('keeps a scheduled run when an earlier trading date is missing', () => {
    expect(
      shouldSkipScheduledClosedDay({
        trigger: 'timer',
        pendingDates: 1,
        todayIsOpen: 0,
      }),
    ).toBe(false);
  });

  it('does not silently skip when the refreshed calendar has no row for today', () => {
    expect(
      shouldSkipScheduledClosedDay({
        trigger: 'timer',
        pendingDates: 0,
        todayIsOpen: null,
      }),
    ).toBe(false);
  });

  it('leaves manual and explicit-date runs unchanged', () => {
    expect(
      shouldSkipScheduledClosedDay({
        trigger: 'manual',
        pendingDates: 0,
        todayIsOpen: 0,
      }),
    ).toBe(false);
    expect(
      shouldSkipScheduledClosedDay({
        trigger: 'timer',
        targetDate: '20261001',
        pendingDates: 0,
        todayIsOpen: 0,
      }),
    ).toBe(false);
  });
});
