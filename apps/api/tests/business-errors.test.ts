import { AgentError } from '#agent/errors.js';
import { MaintenanceError } from '#maintenance/errors.js';
import { AuthError } from '#auth/errors.js';
import { FactorError } from '#factor/errors.js';
import { t } from '#i18n/index.js';
import { BusinessError, errorMessage } from '#infra/errors.js';
import { handleApiError, validateJson } from '#infra/http/errors.js';
import { MarketError, TushareError } from '#market/errors.js';
import { ResearchError } from '#research/errors.js';
import { SharingError } from '#sharing/errors.js';
import { SignalsError } from '#signals/errors.js';
import { StrategyError } from '#strategy/errors.js';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

describe('Business errors at the HTTP boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [new StrategyError('strategy_not_found'), 404, 'NOT_FOUND'],
    [new FactorError('factor_turn_in_progress'), 409, 'CONFLICT'],
    [new ResearchError('document_run_in_progress'), 409, 'CONFLICT'],
    [new SignalsError('paused'), 409, 'CONFLICT'],
    [new MarketError('start_after_end'), 400, 'VALIDATION_FAILED'],
    [new AgentError('sql_select_required'), 400, 'VALIDATION_FAILED'],
    [new AuthError('login_required'), 401, 'UNAUTHORIZED'],
    [new AuthError('account_disabled'), 403, 'FORBIDDEN'],
    [new AuthError('email_send_failed'), 503, 'SERVICE_UNAVAILABLE'],
    [new SharingError('strategy_not_found'), 404, 'NOT_FOUND'],
    [new MaintenanceError('in_progress'), 503, 'MAINTENANCE'],
  ] as const)('maps %s through a nested route to %s', async (error, status, code) => {
    const child = new Hono().get('/failure', () => {
      throw error;
    });
    const app = new Hono().onError(handleApiError).route('/nested', child);
    for (const locale of ['zh', 'en'] as const) {
      const response = await app.request('/nested/failure', {
        headers: { 'Accept-Language': locale },
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: { code, message: errorMessage(error, locale) },
      });
    }
  });

  it('retains revision conflict details and keeps the cause private', async () => {
    const currentCell = { id: 'cell', source: 'latest source', revision: 3 };
    const cause = new Error('Internal diagnostic');
    const error = new ResearchError('cell_revision_conflict', {
      details: { reason: 'cell_revision_changed', currentCell },
      cause,
    });
    const app = new Hono().onError(handleApiError).get('/', () => {
      throw error;
    });
    const response = await app.request('/', { headers: { 'Accept-Language': 'en' } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: t('en', 'researchCellRevisionConflict'),
        details: { reason: 'cell_revision_changed', currentCell },
      },
    });
    expect(error.cause).toBe(cause);
  });

  it('formats parameters at the caller boundary and preserves embedded protocol codes', () => {
    const error = new SignalsError('data_not_ready', { params: { date: '20260917' } });
    expect(errorMessage(error, 'zh')).toBe(t('zh', 'signalDataNotReady', { date: '20260917' }));
    const embedded = new ResearchError('embedded_cancelled');
    expect(embedded).toBeInstanceOf(BusinessError);
    expect(embedded.embeddedCode).toBe('cancelled');
    expect(embedded.details).toEqual({ reason: 'cancelled' });
  });

  it.each([
    new Error('SQLite failed: private database path'),
    new TushareError('daily', 2002, 'upstream diagnostic'),
    z.object({ id: z.string() }).safeParse({}).error!,
  ])('keeps an unknown or internal decoding failure out of a 400 response', async (failure) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = new Hono().onError(handleApiError).get('/', () => {
      throw failure;
    });
    const response = await app.request('/', { headers: { 'Accept-Language': 'zh' } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: t('zh', 'internalError') },
    });
    expect(log).toHaveBeenCalledWith('[api] Unhandled request error', failure);
  });

  it('keeps external JSON/schema failures at 400', async () => {
    const operation = vi.fn();
    const app = new Hono()
      .onError(handleApiError)
      .post('/', validateJson(z.object({ name: z.string() })), (context) => {
        operation();
        return context.json({ ok: true });
      });
    for (const body of ['{', JSON.stringify({ name: 42 })]) {
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(operation).not.toHaveBeenCalled();
  });

  it('preserves Retry-After and maintenance details when middleware rejects a request', async () => {
    const status = { active: true, retryAfterSeconds: 30 };
    const app = new Hono().onError(handleApiError);
    app.use('*', (context) => {
      context.header('Retry-After', '30');
      throw new MaintenanceError('in_progress', { details: status });
    });
    app.get('/', (context) => context.json({ ok: true }));
    const response = await app.request('/');
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await response.json()).toMatchObject({
      error: { code: 'MAINTENANCE', details: status },
    });
  });
});
