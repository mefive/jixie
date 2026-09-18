import { describe, expect, it } from 'vitest';
import { selectWeeklyTargetKey } from './weekly.js';

describe('weekly maintenance recovery target', () => {
  it('resumes the blocking failed target across an ISO-week boundary', () => {
    expect(
      selectWeeklyTargetKey('20260819', {
        status: 'error',
        targetKey: '2026-W33',
      }),
    ).toBe('2026-W33');
  });

  it('uses the current ISO week after the latest weekly run succeeds', () => {
    expect(
      selectWeeklyTargetKey('20260819', {
        status: 'done',
        targetKey: '2026-W33',
      }),
    ).toBe('2026-W34');
  });
});
