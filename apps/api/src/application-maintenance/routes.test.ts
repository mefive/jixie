import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getMaintenanceStatus: vi.fn(), protectedHandler: vi.fn() }));
vi.mock('./state.js', () => ({ getMaintenanceStatus: mocks.getMaintenanceStatus }));

import { maintenanceRoute } from './routes.js';
import { maintenanceGate } from './middleware.js';

const app = new Hono();
app.route('/api/maintenance', maintenanceRoute);
app.use('/api/app/*', maintenanceGate);
app.get('/api/app/resource', (context) => {
  mocks.protectedHandler();
  return context.json({ ok: true });
});

describe('maintenance HTTP entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('keeps maintenance status publicly readable while maintenance is active', async () => {
    const status = { active: true, runId: 'maintenance-run', retryAfterSeconds: 5 };
    mocks.getMaintenanceStatus.mockResolvedValue(status);

    const response = await app.request('/api/maintenance/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(status);
    expect(mocks.protectedHandler).not.toHaveBeenCalled();
  });

  it('blocks protected handlers and exposes the retry interval during maintenance', async () => {
    const status = { active: true, runId: 'maintenance-run', retryAfterSeconds: 5 };
    mocks.getMaintenanceStatus.mockResolvedValue(status);

    const response = await app.request('/api/app/resource');

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toMatchObject({
      error: { code: 'MAINTENANCE', details: status },
    });
    expect(mocks.protectedHandler).not.toHaveBeenCalled();
  });

  it('allows protected handlers when maintenance is inactive', async () => {
    mocks.getMaintenanceStatus.mockResolvedValue({ active: false, retryAfterSeconds: 5 });

    const response = await app.request('/api/app/resource');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(mocks.protectedHandler).toHaveBeenCalledOnce();
  });
});
