import { JobService } from './job-service.js';
import { strategyBacktestLifecycle } from '#strategy/backtests/job-lifecycle.js';
import { strategyScanLifecycle } from '#strategy/scans/job-lifecycle.js';
import { factorAnalysisLifecycle } from '#factor/evaluations/job-lifecycle.js';
import { researchEmbeddedAnalysisLifecycle } from '#research/embedded/job-lifecycle.js';

/**
 * 显式注册业务任务处理器，不启动任务或执行恢复。
 *
 * Explicit process setup: registration never starts work or recovers Jobs.
 */
export function registerJobLifecycles(): void {
  JobService.register('backtest', strategyBacktestLifecycle);
  JobService.register('strategy-scan', strategyScanLifecycle);
  JobService.register('factor-analysis', factorAnalysisLifecycle);
  JobService.register(
    'research-embedded-analysis',
    researchEmbeddedAnalysisLifecycle,
    'researchExecutionId',
  );
}
