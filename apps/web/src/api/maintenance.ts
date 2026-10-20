import { request } from './client';

/**
 * 提供维护可用性与执行状态，供应用门禁。
 *
 * Describe maintenance availability and execution state for app gating.
 */
export interface MaintenanceStatus {
  active: boolean;
  phase?:
    | 'preparing'
    | 'publishing'
    | 'postprocessing'
    | 'error'
    | 'legacy'
    | 'idle'
    | 'uninitialized';
  running?: boolean;
  dataReady?: boolean;
  runId: string | null;
  kind: 'daily' | 'weekly' | 'repair' | 'deploy' | null;
  startDate: string | null;
  endDate: string | null;
  completedDates: number;
  totalDates: number;
  lastSuccessfulDailyDate: string | null;
  stage: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  error: string | null;
  retryAfterSeconds: number;
}

export function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  return request('/api/maintenance/status');
}

/**
 * 标识已发布部署版本，供前端检测需要刷新。
 *
 * Identify a deployed release for client refresh detection.
 */
export interface DeploymentVersion {
  revision: string | null;
}

export function fetchDeploymentVersion(signal: AbortSignal): Promise<DeploymentVersion> {
  return request('/api/maintenance/version', { cache: 'no-store', signal });
}
