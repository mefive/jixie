import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { handleApiError } from '#infra/http/errors.js';

vi.mock('../scans/submit.js', () => ({ submitStrategyScan: vi.fn() }));
vi.mock('../scans/reports.js', () => ({
  findActiveStrategyScanJob: vi.fn(),
  listStrategyScanReports: vi.fn(),
  readStrategyScanJob: vi.fn(),
  readStrategyScanReport: vi.fn(),
}));
vi.mock('../runtime/strategy-runtime.js', () => {
  throw new Error('Parameter inspection must not load StrategyRuntime');
});
vi.mock('#infra/runtime/typescript/transport.js', () => {
  throw new Error('Parameter inspection must not load the isolate transport');
});

import { strategyScanRoute } from './scan.js';

const app = new Hono().onError(handleApiError);
app.route('/api/app/strategies', strategyScanRoute);

function inspect(body: unknown, locale = 'en') {
  return app.request('/api/app/strategies/scan-parameters/inspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': locale },
    body: JSON.stringify(body),
  });
}

describe('POST scan-parameters/inspect with the real static parser', () => {
  it('preserves the response and never executes submitted source', async () => {
    const response = await inspect({
      code: `throw new Error('must not run');
        export default defineStrategy({ params: { lookback: 20, threshold: -0.5, sizing: 'equal' } });`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      parameters: { lookback: 20, threshold: -0.5, sizing: 'equal' },
    });
  });

  it('returns an empty parameters object for an omitted declaration', async () => {
    const response = await inspect({ code: 'export default defineStrategy({ onBar() {} });' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ parameters: {} });
  });

  it.each([
    ['en', 'Cannot statically inspect'],
    ['zh', '无法静态识别'],
  ])('returns localized actionable errors in %s', async (locale, message) => {
    const response = await inspect(
      {
        code: 'export default defineStrategy({ params: { lookback: getLookback() } });',
      },
      locale,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.stringContaining(message),
        details: { field: 'params.lookback', line: 1, syntax: 'CallExpression' },
      },
    });
  });

  it('preserves Python rejection and request validation', async () => {
    const python = await inspect({ language: 'python', code: 'raise Exception()' });
    expect(python.status).toBe(400);
    expect(await python.json()).toMatchObject({
      error: { message: expect.stringContaining('py-v1 does not support parameter scans') },
    });
    expect((await inspect({})).status).toBe(400);
  });
});
