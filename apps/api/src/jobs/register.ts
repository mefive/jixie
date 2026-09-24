import { JobService } from './service.js';
import { strategyBacktestLifecycle } from '#strategy/backtests/strategy-backtest-lifecycle.js';
import { strategyScanLifecycle } from '#strategy/scans/strategy-scan-lifecycle.js';
import { factorAnalysisLifecycle } from '#factor/evaluations/factor-analysis-lifecycle.js';
import { factorCorrelationLifecycle } from '#factor/correlations/factor-correlation-lifecycle.js';
import { signalsRunLifecycle } from '#signals/runs/signals-run-lifecycle.js';
import { researchEmbeddedAnalysisLifecycle } from '#research/embedded/research-embedded-analysis-lifecycle.js';
import { researchCuratorLifecycle } from '#research/curator/research-curator-lifecycle.js';

/** Explicit process setup: registration never starts work or recovers Jobs. */
export function registerJobLifecycles(): void {
  JobService.register('backtest', strategyBacktestLifecycle);
  JobService.register('strategy-scan', strategyScanLifecycle);
  JobService.register('factor-analysis', factorAnalysisLifecycle);
  JobService.register('factor-correlation', factorCorrelationLifecycle);
  JobService.register('signal', signalsRunLifecycle, 'signalRunId');
  JobService.register(
    'research-embedded-analysis',
    researchEmbeddedAnalysisLifecycle,
    'researchExecutionId',
  );
  JobService.register('research-curator', researchCuratorLifecycle);
}
