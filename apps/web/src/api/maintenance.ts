import { request } from './client';

export interface MaintenanceStatus {
  active: boolean;
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

export interface DeploymentVersion {
  revision: string | null;
}

export function fetchDeploymentVersion(signal: AbortSignal): Promise<DeploymentVersion> {
  return request('/api/maintenance/version', { cache: 'no-store', signal });
}
