import type {
  DeploymentListRequestQuery,
  ActualExecutionRequest,
  SignalRunListRequestQuery,
  SignalRunJobRequestQuery,
  CreateDeploymentRequest,
  SubmitSignalRunRequest,
} from '@jixie/shared/api/signals';
import type {
  ActualExecutionUpdate,
  SignalRun,
  SignalTodayEntry,
  StrategyExecutionOverview,
  StrategyDeployment,
} from '@jixie/shared';
import { serializeQuery, request } from './client';
import type { BacktestJob } from './strategy';

// —— Daily signals ——

export function deployBacktestReport(reportId: string): Promise<StrategyDeployment> {
  return request('/api/app/signals/deployments', {
    method: 'POST',
    body: JSON.stringify({ reportId } satisfies CreateDeploymentRequest),
  });
}

export function pauseStrategyDeployment(deploymentId: string): Promise<StrategyDeployment> {
  return request(`/api/app/signals/deployments/${deploymentId}/pause`, { method: 'POST' });
}

export function listStrategyDeployments(strategyId: string): Promise<StrategyDeployment[]> {
  const query = serializeQuery({ strategyId } satisfies DeploymentListRequestQuery);
  return request(`/api/app/signals/deployments?${query}`);
}

export function listDeploymentLatestRuns(): Promise<SignalTodayEntry[]> {
  return request('/api/app/signals/deployments/latest-runs');
}

export function listSignalRuns(deploymentId: string, limit = 30): Promise<SignalRun[]> {
  const query = serializeQuery({ limit: String(limit) } satisfies SignalRunListRequestQuery);
  return request(`/api/app/signals/deployments/${encodeURIComponent(deploymentId)}/runs?${query}`);
}

export function submitSignalRun(
  deploymentId: string,
  tradeDate?: string,
): Promise<{ runId: string; jobId: string | null; started: boolean }> {
  return request(`/api/app/signals/deployments/${encodeURIComponent(deploymentId)}/runs`, {
    method: 'POST',
    body: JSON.stringify((tradeDate ? { tradeDate } : {}) satisfies SubmitSignalRunRequest),
  });
}

export function pollSignalJob(jobId: string, since = 0): Promise<BacktestJob> {
  const query = serializeQuery({ since: String(since) } satisfies SignalRunJobRequestQuery);
  return request(`/api/app/signals/run-jobs/${jobId}?${query}`);
}

export function getStrategyExecutionOverview(
  deploymentId: string,
): Promise<StrategyExecutionOverview> {
  return request(`/api/app/signals/deployments/${deploymentId}/execution-overview`);
}

export function updateSignalExecution(
  executionId: string,
  input: ActualExecutionUpdate,
): Promise<SignalRun> {
  return request(`/api/app/signals/executions/${executionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input satisfies ActualExecutionRequest),
  });
}
