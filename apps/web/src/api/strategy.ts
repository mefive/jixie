import type {
  StrategyCodeConfigRequest,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  StrategyVisibilityRequest,
  StrategyBacktestRequestParams,
  StrategyBacktestJobRequestQuery,
  StrategyScanRequestParams,
  StrategyScanJobRequestQuery,
  InspectStrategyParametersRequest,
  SubmitStrategyScanRequest,
  StrategyAgentRequest,
  StrategyAgentRequestParams,
} from '@jixie/shared/api/strategy';
import type {
  BacktestConfig,
  BacktestReportDetail,
  BacktestReportSummary,
  LogLine,
  StrategyScanReport,
  StrategyScanReportSummary,
  StrategyScanSpec,
  StrategyParamValue,
  AssetVisibility,
  SavedMeta,
  SavedStrategy,
  StrategyCard,
} from '@jixie/shared';
import { serializeQuery, request } from './client';

// A backtest Job (runs in a worker). Poll carries the log lines after `since` + `nextSince`. Status
// only — the result lands on BacktestReport and mirrors to Strategy.lastResult as the latest cache.
// 'stale' = the run's process died.
// Logs are tagged LogLine (system progress vs the strategy's own console.*).
export interface BacktestJob {
  status: 'queued' | 'running' | 'done' | 'error' | 'stale';
  queuePosition?: number;
  backtestReportId?: string | null;
  logs: LogLine[];
  nextSince: number;
  error?: string | null;
}

// Commit a saved strategy's runnable config and start its immutable report atomically.
export function submitBacktest(
  config: BacktestConfig,
  strategyId: StrategyBacktestRequestParams['strategyId'],
): Promise<{ jobId: string; reportId: string }> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/backtests`, {
    method: 'POST',
    body: JSON.stringify(config satisfies StrategyCodeConfigRequest),
  });
}

// Poll a backtest job — `since` = how many log lines the client already has (incremental tail).
export function pollBacktest(jobId: string, since = 0): Promise<BacktestJob> {
  const query = serializeQuery({ since: String(since) } satisfies StrategyBacktestJobRequestQuery);
  return request(`/api/app/strategies/backtest-jobs/${encodeURIComponent(jobId)}?${query}`);
}

// Find a queued or running backtest and its report to reconnect after a refresh.
export function findActiveBacktestJob(
  strategyId: StrategyBacktestRequestParams['strategyId'],
): Promise<{ jobId: string; reportId: string } | null> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/backtest-jobs/active`);
}

export function listBacktestReports(
  strategyId: StrategyBacktestRequestParams['strategyId'],
): Promise<BacktestReportSummary[]> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/backtest-reports`);
}

export function getBacktestReport(reportId: string): Promise<BacktestReportDetail> {
  return request(`/api/app/strategies/backtest-reports/${encodeURIComponent(reportId)}`);
}

export function inspectStrategyParameters(
  code: string,
): Promise<{ parameters: Record<string, StrategyParamValue> }> {
  return request('/api/app/strategies/scan-parameters/inspect', {
    method: 'POST',
    body: JSON.stringify({ code } satisfies InspectStrategyParametersRequest),
  });
}

export function submitStrategyScan(
  strategyId: StrategyScanRequestParams['strategyId'],
  config: BacktestConfig,
  spec: StrategyScanSpec,
): Promise<{ reportId: string; jobId: string }> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/scans`, {
    method: 'POST',
    body: JSON.stringify({ config, spec } satisfies SubmitStrategyScanRequest),
  });
}

export function listStrategyScanReports(
  strategyId: StrategyScanRequestParams['strategyId'],
): Promise<StrategyScanReportSummary[]> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/scan-reports`);
}

export function findActiveStrategyScanJob(
  strategyId: StrategyScanRequestParams['strategyId'],
): Promise<{ jobId: string; reportId: string } | null> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/scan-jobs/active`);
}

export function getStrategyScanReport(reportId: string): Promise<StrategyScanReport> {
  return request(`/api/app/strategies/scan-reports/${encodeURIComponent(reportId)}`);
}

export function pollStrategyScan(jobId: string, since = 0): Promise<BacktestJob> {
  const query = serializeQuery({ since: String(since) } satisfies StrategyScanJobRequestQuery);
  return request(`/api/app/strategies/scan-jobs/${encodeURIComponent(jobId)}?${query}`);
}

// Agent: START one turn (the model iterates on the current code; history lives on the strategy row).
// Returns a turnId immediately — subscribe via subscribeAgentTurn to stream the reply.
export function sendAgent(
  strategyId: StrategyAgentRequestParams['strategyId'],
  message: string,
  code: string,
  language: 'typescript' | 'python' = 'typescript',
  analysis?: Pick<StrategyAgentRequest, 'reportId' | 'dataReferences'>,
): Promise<{ turnId: string }> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/agent/turns`, {
    method: 'POST',
    body: JSON.stringify({ message, code, language, ...analysis } satisfies StrategyAgentRequest),
  });
}

// —— Saved strategies (product line 1 persistence) —— created on the first Agent prompt, then updated by id:
// messages in real time, config/name on a run.

export function listStrategies(): Promise<StrategyCard[]> {
  return request('/api/app/strategies');
}

export function getStrategy(id: string): Promise<SavedStrategy> {
  return request(`/api/app/strategies/${id}`);
}

// Create a NEW strategy row. The server names it from `prompt`, or from code when prompt is absent.
export function createStrategy(config: BacktestConfig, prompt?: string): Promise<SavedMeta> {
  const { name: _clientName, ...runnableConfig } = config;
  const body = { ...runnableConfig, ...(prompt ? { prompt } : {}) };
  return request('/api/app/strategies', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateStrategyRequest),
  });
}

// Update an existing strategy by id. `{ messages }` alone = real-time chat save (config untouched);
// `{ config }` = a run's config/name update (drops the stale lastResult when code/range/capital moved).
export function updateStrategy(id: string, patch: UpdateStrategyRequest): Promise<SavedMeta> {
  return request(`/api/app/strategies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch satisfies UpdateStrategyRequest),
  });
}

export function deleteStrategy(id: string): Promise<{ ok: true }> {
  return request(`/api/app/strategies/${id}`, { method: 'DELETE' });
}

export function setStrategyVisibility(
  id: string,
  visibility: AssetVisibility,
): Promise<{ id: string; visibility: AssetVisibility }> {
  return request(`/api/app/strategies/${encodeURIComponent(id)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility } satisfies StrategyVisibilityRequest),
  });
}
