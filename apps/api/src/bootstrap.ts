import { prisma, withDatabase, type Prisma } from '#infra/database/prisma.js';
import { serve } from '@hono/node-server';
import { buildApp } from './server.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { JobService } from '#jobs/job-service.js';
import { JobScheduler } from '#jobs/job-scheduler.js';
import { pruneFactorReports } from '#factor/evaluations/retention.js';
import { seedBuiltinFactors } from '#factor/definitions/seed.js';
import { resetInterruptedFactorWeatherRefreshes } from '#factor/weather/refresh.js';
import { markRunningAgentTurnsInterrupted } from '#agent/turns/records.js';

/**
 * 完成应用恢复与调度器初始化后启动 HTTP 服务，并接入退出清理。
 *
 * Recover application state and initialize dispatch before starting HTTP with shutdown cleanup.
 */
export async function startServer(port: number, database: Prisma = prisma) {
  return withDatabase(database, async () => {
    const app = buildApp(database);
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
      console.log(
        `[jixie] reset ${interruptedWeather} interrupted factor weather run(s) to pending`,
      );
    }

    // 先准备缺失内置版本和报告保留规则，再接收请求或启动排队任务。
    // Prepare missing builtin versions and report retention before serving or dispatching queued work.
    await seedBuiltinFactors();
    await database.$transaction((transaction) => pruneFactorReports(transaction));
    JobScheduler.initialize(JobService.execute);
    JobScheduler.wake();
    serve({ fetch: app.fetch, port });
    return app;
  });
}
