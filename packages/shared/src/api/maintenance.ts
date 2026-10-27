/**
 * 数据覆盖事实；目标日期不等于完整覆盖日期。
 *
 * Coverage facts; a target is not a completion date.
 */
export interface DatasetCoverage {
  dataset: string;
  scope: string;
  maxObservedDate: string | null;
  verifiedThrough: string | null;
  pending: number;
  errors: number;
}

/**
 * 唯一同步尝试的公开摘要。
 *
 * Public summary of one unified synchronization attempt.
 */
export interface DataSyncResult {
  runId: string;
  targetDate: string;
  status: 'complete' | 'partial' | 'error';
  partitions: number;
  accepted: { inserted: number; updated: number; deleted: number; rejected: number };
  coverage: DatasetCoverage[];
  gaps: string[];
  errors: string[];
}

/**
 * 只有真实发布争用和部署关闭准入；空库和缺口保留局部可用。
 *
 * Only live publication or deployment gates access; gaps and empty data remain local.
 */
export interface MaintenanceStatus {
  active: boolean;
  running: boolean;
  phase: 'idle' | 'preparing' | 'publishing' | 'postprocessing' | 'error' | 'uninitialized';
  runId: string | null;
  kind: 'sync' | 'deploy' | null;
  targetDate: string | null;
  stage: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  error: string | null;
  retryAfterSeconds: number;
  revision: number;
  coverage: DatasetCoverage[];
}
