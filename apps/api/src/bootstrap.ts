import { serve } from '@hono/node-server';
import { buildApp } from './server.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { JobService } from '#jobs/service.js';
import { JobScheduler } from '#jobs/scheduler.js';
import { seedBuiltinFactors } from '#factor/definitions/seed.js';
import { resetInterruptedFactorWeatherRefreshes } from '#factor/weather/refresh.js';
import { markRunningAgentTurnsInterrupted } from '#agent/turns/records.js';

export async function startServer(port: number) {
  const app = buildApp();
  registerJobLifecycles();

  // Any job left 'running' from a previous process is a zombie (its worker died) → mark stale.
  const [staleJobs, interruptedTurns, interruptedWeather] = await Promise.all([
    JobService.recoverInterrupted(),
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
  JobScheduler.initialize(JobService.execute);
  JobScheduler.wake();
  serve({ fetch: app.fetch, port });
  return app;
}
