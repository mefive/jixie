import { serve } from '@hono/node-server';
import { buildApp } from './server.js';
import { startJobQueue } from './infra/jobs/queue.js';
import { createJobExecutor } from './infra/jobs/executor.js';
import type { JobRegistry } from './infra/jobs/definition.js';
import { seedBuiltinFactors } from './factor/definitions/builtin-factors.js';
import { resetInterruptedFactorWeatherRefreshes } from './factor/weather/refresh.js';
import { markRunningAgentTurnsInterrupted } from './agent/turns/records.js';

export const jobRegistry: JobRegistry = {
  backtest: async () => (await import('./strategy/backtest-job.js')).backtestJob,
  factor: async () => (await import('./factor/factor-job.js')).factorJob,
  'strategy-scan': async () => (await import('./strategy/scan-job.js')).strategyScanJob,
  signal: async () => (await import('./signals/signal-job.js')).signalJob,
  'research-curator': async () => (await import('./research/curator-job.js')).researchCuratorJob,
};

export async function startServer(port: number) {
  const app = buildApp();
  const executor = createJobExecutor(jobRegistry);

  // Any job left 'running' from a previous process is a zombie (its worker died) → mark stale.
  const [staleJobs, interruptedTurns, interruptedWeather] = await Promise.all([
    executor.recoverInterruptedJobs(),
    markRunningAgentTurnsInterrupted(),
    resetInterruptedFactorWeatherRefreshes(),
  ]);
  if (staleJobs) {
    console.log(`[jixie] marked ${staleJobs} orphaned job(s) as stale`);
  }
  if (interruptedTurns) {
    console.log(`[jixie] marked ${interruptedTurns} orphaned Agent turn(s) as interrupted`);
  }
  if (interruptedWeather) {
    console.log(`[jixie] reset ${interruptedWeather} interrupted factor weather run(s) to pending`);
  }

  // Materialize the built-in preset factors (idempotent; repo is the source of truth).
  void seedBuiltinFactors().catch((e) => console.error('[jixie] preset factor seed failed', e));
  startJobQueue(executor);
  serve({ fetch: app.fetch, port });
  return app;
}
