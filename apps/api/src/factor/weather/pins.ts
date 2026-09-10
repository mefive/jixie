import { ulid } from 'ulid';
import { z } from 'zod';
import type { FactorWeatherDirection, FactorWeatherPinStatus } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { factorAnalysisSourceHash } from '../analysis-job.js';
import {
  FACTOR_WEATHER_METHODOLOGY_HASH,
  factorWeatherMethodology,
  refreshFactorWeatherPin,
  toFactorWeatherPoint,
} from './refresh.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

const builtinDirections = new Map(
  BUILTIN_FACTORS.map((factor) => [factor.key, factor.expectedDirection]),
);

export const createFactorWeatherPinSchema = z.object({
  factorId: z.string().min(1),
  direction: z.enum(['positive', 'negative']).optional(),
});

export async function listFactorWeatherPins(userId: string, locale: Locale) {
  const pins = await prisma.factorWeatherPin.findMany({
    where: { userId },
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

  return {
    methodology: factorWeatherMethodology(),
    pins: pins.map((pin) => ({
      id: pin.id,
      factorId: pin.factorId,
      factorName: pin.factorName,
      builtin: pin.builtin,
      direction: pin.direction as FactorWeatherDirection,
      status: pin.status as FactorWeatherPinStatus,
      error: pin.error ? t(locale, 'factorWeatherComputeFailed') : undefined,
      computedThrough: pin.computedThrough ?? undefined,
      codeHash: pin.factorCodeHash,
      points: pin.points.map(toFactorWeatherPoint),
      createdAt: pin.createdAt.toISOString(),
    })),
  };
}

export async function createFactorWeatherPin(
  userId: string,
  input: z.infer<typeof createFactorWeatherPinSchema>,
  locale: Locale,
) {
  const { factorId, direction: requestedDirection } = input;
  const factor = await prisma.factor.findFirst({
    where: { id: factorId, userId: { in: [userId, BUILTIN_USER_ID] } },
    select: {
      id: true,
      userId: true,
      key: true,
      name: true,
      code: true,
      language: true,
      runtimeVersion: true,
      status: true,
    },
  });

  if (!factor) {
    return failFactorOperation('missing', t(locale, 'factorNotFound'));
  }

  const builtin = factor.userId === BUILTIN_USER_ID;

  if (!builtin && factor.status !== 'published') {
    return failFactorOperation('invalid', t(locale, 'factorWeatherRequiresFinalized'));
  }

  const direction = builtinDirections.get(factor.id) ?? requestedDirection;

  if (!direction) {
    return failFactorOperation('invalid', t(locale, 'factorWeatherDirectionRequired'));
  }

  const existing = await prisma.factorWeatherPin.findUnique({
    where: { userId_factorId: { userId, factorId } },
  });
  const pin =
    existing ??
    (await prisma.factorWeatherPin.create({
      data: {
        id: ulid(),
        userId,
        factorId,
        factorName: factor.name,
        builtin,
        direction,
        factorCode: factor.code,
        factorCodeHash: factorAnalysisSourceHash(
          factor.code,
          factor.language === 'python' ? 'python' : 'typescript',
        ),
        language: factor.language,
        runtimeVersion: factor.runtimeVersion,
        methodologyHash: FACTOR_WEATHER_METHODOLOGY_HASH,
        status: 'pending',
      },
    }));

  void refreshFactorWeatherPin(pin.id).catch((error) =>
    console.error('[jixie] factor weather refresh failed', pin.id, error),
  );

  return { id: pin.id, status: pin.status };
}

export async function requestFactorWeatherRefresh(userId: string, pinId: string, locale: Locale) {
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { id: pinId, userId },
    select: { id: true },
  });

  if (!pin) {
    return failFactorOperation('missing', t(locale, 'factorWeatherPinNotFound'));
  }

  void refreshFactorWeatherPin(pin.id).catch((error) =>
    console.error('[jixie] factor weather refresh failed', pin.id, error),
  );

  return { id: pin.id, status: 'running' as const };
}

export async function deleteFactorWeatherPin(userId: string, pinId: string, locale: Locale) {
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { id: pinId, userId },
    select: { id: true, status: true },
  });

  if (!pin) {
    return failFactorOperation('missing', t(locale, 'factorWeatherPinNotFound'));
  }

  if (pin.status === 'pending' || pin.status === 'running') {
    return failFactorOperation('conflict', t(locale, 'factorWeatherRunningCannotUnpin'));
  }

  await prisma.factorWeatherPin.delete({ where: { id: pin.id } });

  return { ok: true };
}
