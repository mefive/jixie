import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import type { FactorWeatherDirection, FactorWeatherPinStatus, Locale } from '@jixie/shared';
import { ulid } from 'ulid';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { FactorError } from '../errors.js';
import type { CreateFactorWeatherPinInput } from '../schema.js';
import { factorAnalysisSourceHash } from '../sources/snapshot.js';
import {
  FACTOR_WEATHER_METHODOLOGY_HASH,
  factorWeatherMethodology,
  refreshFactorWeatherPin,
  toFactorWeatherPoint,
} from './refresh.js';

const builtinDirections = new Map(
  BUILTIN_FACTORS.map((factor) => [factor.key, factor.expectedDirection]),
);

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

export async function createFactorWeatherPin(userId: string, input: CreateFactorWeatherPinInput) {
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
    throw new FactorError('factor_not_found');
  }

  const builtin = factor.userId === BUILTIN_USER_ID;

  if (!builtin && factor.status !== 'published') {
    throw new FactorError('factor_weather_requires_finalized');
  }

  const direction = builtinDirections.get(factor.id) ?? requestedDirection;

  if (!direction) {
    throw new FactorError('factor_weather_direction_required');
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

export async function requestFactorWeatherRefresh(userId: string, pinId: string) {
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { id: pinId, userId },
    select: { id: true },
  });

  if (!pin) {
    throw new FactorError('factor_weather_pin_not_found');
  }

  void refreshFactorWeatherPin(pin.id).catch((error) =>
    console.error('[jixie] factor weather refresh failed', pin.id, error),
  );

  return { id: pin.id, status: 'running' as const };
}

export async function deleteFactorWeatherPin(userId: string, pinId: string) {
  const pin = await prisma.factorWeatherPin.findFirst({
    where: { id: pinId, userId },
    select: { id: true, status: true },
  });

  if (!pin) {
    throw new FactorError('factor_weather_pin_not_found');
  }

  if (pin.status === 'pending' || pin.status === 'running') {
    throw new FactorError('factor_weather_running_cannot_unpin');
  }

  await prisma.factorWeatherPin.delete({ where: { id: pin.id } });

  return { ok: true };
}
