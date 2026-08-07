import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { FactorWeatherDirection, FactorWeatherPinStatus } from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { m } from '../i18n/index.js';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from '../factor/builtin-factors.js';
import { sha256 } from '../factor/report-spec.js';
import {
  FACTOR_WEATHER_METHODOLOGY_HASH,
  factorWeatherMethodology,
  refreshFactorWeatherPin,
  toFactorWeatherPoint,
} from '../factor/weather.js';

const builtinDirections = new Map(
  BUILTIN_FACTORS.map((factor) => [factor.key, factor.expectedDirection]),
);

const createPinBody = z.object({
  factorId: z.string().min(1),
  direction: z.enum(['positive', 'negative']).optional(),
});

export const factorWeatherRoute = new Hono();

factorWeatherRoute.get('/', async (c) => {
  const pins = await prisma.factorWeatherPin.findMany({
    where: { userId: c.var.userId },
    include: { points: { orderBy: { periodEndDate: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  for (const pin of pins) {
    if (pin.status === 'pending' || pin.status === 'running') {
      void refreshFactorWeatherPin(pin.id).catch((error) =>
        console.error('[jixie] factor weather refresh failed', pin.id, error),
      );
    }
  }

  return c.json({
    methodology: factorWeatherMethodology(),
    pins: pins.map((pin) => ({
      id: pin.id,
      factorId: pin.factorId,
      factorName: pin.factorName,
      builtin: pin.builtin,
      direction: pin.direction as FactorWeatherDirection,
      status: pin.status as FactorWeatherPinStatus,
      error: pin.error ? m(c, 'factorWeatherComputeFailed') : undefined,
      computedThrough: pin.computedThrough ?? undefined,
      codeHash: pin.factorCodeHash,
      points: pin.points.map(toFactorWeatherPoint),
      createdAt: pin.createdAt.toISOString(),
    })),
  });
});

factorWeatherRoute.post('/pins', validateJson(createPinBody), async (c) => {
  const { factorId, direction: requestedDirection } = c.req.valid('json');
  const factor = await prisma.factor.findFirst({
    where: { id: factorId, userId: { in: [c.var.userId, BUILTIN_USER_ID] } },
    select: { id: true, userId: true, key: true, name: true, code: true, status: true },
  });
  if (!factor) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
  }
  const builtin = factor.userId === BUILTIN_USER_ID;
  if (!builtin && factor.status !== 'published') {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorWeatherRequiresFinalized'));
  }
  const direction = builtinDirections.get(factor.id) ?? requestedDirection;
  if (!direction) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'factorWeatherDirectionRequired'));
  }

  const existing = await prisma.factorWeatherPin.findUnique({
    where: { userId_factorId: { userId: c.var.userId, factorId } },
  });
  const pin =
    existing ??
    (await prisma.factorWeatherPin.create({
      data: {
        id: ulid(),
        userId: c.var.userId,
        factorId,
        factorName: factor.name,
        builtin,
        direction,
        factorCode: factor.code,
        factorCodeHash: sha256(factor.code),
        methodologyHash: FACTOR_WEATHER_METHODOLOGY_HASH,
        status: 'pending',
      },
    }));

  void refreshFactorWeatherPin(pin.id).catch((error) =>
    console.error('[jixie] factor weather refresh failed', pin.id, error),
  );
  return c.json({ id: pin.id, status: pin.status });
});

factorWeatherRoute.post('/pins/:id/refresh', async (c) => {
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
    select: { id: true },
  });
  if (!pin) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorWeatherPinNotFound'));
  }

  void refreshFactorWeatherPin(pin.id).catch((error) =>
    console.error('[jixie] factor weather refresh failed', pin.id, error),
  );
  return c.json({ id: pin.id, status: 'running' as const });
});

factorWeatherRoute.delete('/pins/:id', async (c) => {
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
    select: { id: true, status: true },
  });
  if (!pin) {
    return apiError(c, 'NOT_FOUND', m(c, 'factorWeatherPinNotFound'));
  }
  if (pin.status === 'pending' || pin.status === 'running') {
    return apiError(c, 'CONFLICT', m(c, 'factorWeatherRunningCannotUnpin'));
  }
  await prisma.factorWeatherPin.delete({ where: { id: pin.id } });
  return c.json({ ok: true });
});
