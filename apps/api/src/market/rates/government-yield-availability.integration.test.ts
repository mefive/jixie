import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-market-boundary-');
  writeFileSync(`${fixture.directory}/test.db`, '');
  return {
    prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${fixture.directory}/test.db` }),
  };
});

import { prisma } from '#infra/database/prisma.js';
import { loadGovernmentYieldAvailability } from './government-yield-availability.js';
import {
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_NAME,
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_TYPE,
} from '../registry/yield-curves.js';

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'db',
      'push',
      '--skip-generate',
      '--schema',
      resolve('prisma/schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/test.db` }, stdio: 'pipe' },
  );
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  await rm(fixture.directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.yieldCurvePoint.deleteMany();
  const base = {
    source: CHINA_TREASURY_CURVE_SOURCE,
    curveCode: CHINA_TREASURY_CURVE_CODE,
    curveName: CHINA_TREASURY_CURVE_NAME,
    curveType: CHINA_TREASURY_CURVE_TYPE,
    yieldPct: 2,
  };
  await prisma.yieldCurvePoint.createMany({
    data: [
      { ...base, termYears: 2, tradeDate: '20260803', availableDate: '20260804' },
      { ...base, termYears: 2, tradeDate: '20260804', availableDate: '20260806' },
      { ...base, termYears: 2, tradeDate: '20260805', availableDate: '20260810' },
      { ...base, termYears: 10, tradeDate: '20260722', availableDate: '20260723' },
      { ...base, termYears: 1, tradeDate: '20260805', availableDate: '20260810' },
      { ...base, source: 'other', termYears: 10, tradeDate: '20260806', availableDate: '20260807' },
      {
        ...base,
        curveCode: 'other',
        termYears: 10,
        tradeDate: '20260806',
        availableDate: '20260807',
      },
      {
        ...base,
        curveType: 'spot',
        termYears: 10,
        tradeDate: '20260806',
        availableDate: '20260807',
      },
    ],
  });
});

describe('government yield availability facts', () => {
  it('selects each maturity by available date and excludes future, missing and unrelated curves', async () => {
    expect(await loadGovernmentYieldAvailability([2, 10, 1, 30], '20260807')).toEqual([
      { termYears: 2, availableDate: '20260806' },
      { termYears: 10, availableDate: '20260723' },
    ]);
  });

  it('keeps old observations as facts and includes data on its availability date', async () => {
    expect(await loadGovernmentYieldAvailability([2, 10], '20260810')).toEqual([
      { termYears: 2, availableDate: '20260810' },
      { termYears: 10, availableDate: '20260723' },
    ]);
    expect(await loadGovernmentYieldAvailability([], '20260810')).toEqual([]);
  });
});
