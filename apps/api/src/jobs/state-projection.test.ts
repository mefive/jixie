import { describe, expect, it } from 'vitest';
import { backtestReportState } from '#strategy/backtests/state.js';
import { factorReportState } from '#factor/evaluations/state.js';
import { signalRunState } from '#signals/runs/state.js';
import { researchCuratorRunState } from '#research/curator/state.js';

describe('authoritative execution status', () => {
  it('ignores a legacy success mirror when a linked Job fails', () => {
    expect(
      backtestReportState({
        legacyStatus: 'done',
        legacyError: 'old',
        job: { status: 'error', error: 'technical' },
      }),
    ).toMatchObject({ status: 'error', error: 'technical' });
  });
  it('retains genuine historical terminal state without a Job', () => {
    expect(
      backtestReportState({ legacyStatus: 'stale', legacyError: 'interrupted', job: null }),
    ).toMatchObject({ status: 'stale', error: 'interrupted' });
  });
  it.each([null, 'unknown', 'running', 'queued'])(
    'rejects unexplained jobless state %s',
    (legacyStatus) => {
      expect(() => backtestReportState({ legacyStatus, legacyError: null, job: null })).toThrow();
    },
  );
  it('retains Factor execution localization only for failed linked Jobs', () => {
    const row = {
      legacyStatus: 'done',
      failureMessage: 'localized',
      job: { status: 'error', error: 'technical' },
    };
    expect(factorReportState(row).error).toBe('localized');
    expect(factorReportState({ ...row, failureMessage: null }).error).toBe('technical');
    expect(factorReportState({ ...row, job: { status: 'done', error: null } }).error).toBeNull();
    expect(factorReportState({ ...row, job: null }).error).toBe('localized');
  });
  it('projects queue vocabulary per existing public contract', () => {
    const row = { legacyStatus: null, legacyError: null, job: { status: 'queued', error: null } };
    expect(backtestReportState(row).status).toBe('running');
    expect(researchCuratorRunState(row).status).toBe('queued');
  });
  it('uses the selected current Signals attempt instead of old mirrors', () => {
    expect(
      signalRunState({
        legacyStatus: 'done',
        legacyError: 'old',
        jobs: [{ id: 'latest', status: 'queued', error: null }],
      }),
    ).toMatchObject({ status: 'running', error: null });
  });
});
