import { request } from './client';

import type { MaintenanceStatus } from '@jixie/shared/api/maintenance';
export type { MaintenanceStatus } from '@jixie/shared/api/maintenance';

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
