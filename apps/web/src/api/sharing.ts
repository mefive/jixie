import type { SharingCatalog } from '@jixie/shared';
import { request } from './client';

export function fetchSharingCatalog(signal?: AbortSignal): Promise<SharingCatalog> {
  return request('/api/app/library', { signal });
}

export function copyPublicStrategy(id: string): Promise<{ id: string; name: string }> {
  return request(`/api/app/library/strategies/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
  });
}
