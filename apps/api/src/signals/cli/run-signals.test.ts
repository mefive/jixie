import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), close: vi.fn(), synchronize: vi.fn() }));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {},
  withDatabase: async (_database: unknown, operation: () => Promise<void>) => operation(),
  closeDatabase: mocks.close,
}));
vi.mock('../daily/scheduler.js', () => ({ generateDailySignals: mocks.generate }));
vi.mock('#market/calendar/sse-close.js', () => ({
  latestCompletedTradeDate: async () => '20260915',
}));
vi.mock('#maintenance/sync.js', () => ({ synchronizeData: mocks.synchronize }));

const originalArguments = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  process.argv = ['node', 'run-signals.ts', '20260915'];
  process.exitCode = 0;
  vi.spyOn(console, 'table').mockImplementation(() => {});
});

afterEach(() => {
  process.argv = originalArguments;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

it.each([
  {
    name: 'completed signals with account failure',
    signalErrors: 0,
    accountErrors: 1,
    waiting: 0,
    exitCode: 1,
  },
  {
    name: 'only account input waiting',
    signalErrors: 0,
    accountErrors: 0,
    waiting: 1,
    exitCode: 0,
  },
  { name: 'all work complete', signalErrors: 0, accountErrors: 0, waiting: 0, exitCode: 0 },
  { name: 'signal failure', signalErrors: 1, accountErrors: 0, waiting: 0, exitCode: 1 },
])(
  'R16/A07 sets the entry exit code for $name while only consuming existing data',
  async ({ signalErrors, accountErrors, waiting, exitCode }) => {
    const summary = {
      deployments: 1,
      done: signalErrors ? 0 : 1,
      waiting: 0,
      errors: signalErrors,
      accounts: {
        deployments: 1,
        done: accountErrors || waiting ? 1 : 2,
        waiting,
        errors: accountErrors,
        gaps: waiting ? ['Account fixture: waiting for inputs'] : [],
        failures: accountErrors ? ['Account fixture: controlled failure'] : [],
      },
    };
    mocks.generate.mockResolvedValue(summary);

    await import('./run-signals.js');

    expect(process.exitCode).toBe(exitCode);
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith('20260915');
    expect(console.table).toHaveBeenCalledExactlyOnceWith(summary);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.synchronize).not.toHaveBeenCalled();
  },
);
