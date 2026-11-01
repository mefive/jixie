import { request } from './client';

import type { IngestionStatus } from '@jixie/shared/api/ingestion';
export type { IngestionStatus } from '@jixie/shared/api/ingestion';

export function fetchIngestionStatus(): Promise<IngestionStatus> {
  return request('/api/ingestion/status');
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
  return request('/api/ingestion/version', { cache: 'no-store', signal });
}
