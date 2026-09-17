import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-factor-seed-');
  const database = `${fixture.directory}/seed.db`;
  writeFileSync(database, '');
  return { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
});

import { prisma } from '#infra/database/prisma.js';
import { sha256 } from '../sources/fingerprint.js';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from './builtin-factors.js';
import { seedBuiltinFactors } from './seed.js';
import { PANEL_TEMPLATES } from './templates/panel.js';
import { TIME_SERIES_TEMPLATES } from './templates/time-series.js';

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
    {
      env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/seed.db` },
      stdio: 'pipe',
    },
  );
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  await rm(fixture.directory, { recursive: true, force: true });
});

it('seeds all preset families idempotently and updates definitions without rewriting historical reports', async () => {
  const definitions = [
    ...BUILTIN_FACTORS.map((definition) => ({
      key: definition.key,
      name: definition.label,
      code: definition.code,
      analysisKind: 'cross_sectional',
    })),
    ...TIME_SERIES_TEMPLATES.map((definition) => ({
      key: definition.key,
      name: definition.label.zh,
      code: definition.code,
      analysisKind: 'time_series',
    })),
    ...PANEL_TEMPLATES.map((definition) => ({
      key: definition.key,
      name: definition.label.zh,
      code: definition.code,
      analysisKind: 'panel',
    })),
  ];
  await seedBuiltinFactors();
  const initial = await prisma.factor.findMany({ orderBy: { id: 'asc' } });
  expect(initial).toHaveLength(definitions.length);
  for (const definition of definitions) {
    expect(initial.find((row) => row.id === definition.key)).toMatchObject({
      ...definition,
      userId: BUILTIN_USER_ID,
      status: 'published',
      language: 'typescript',
      runtimeVersion: 'ts-v1',
      codeHash: sha256(definition.code),
      publishedAt: expect.any(Date),
      archivedAt: null,
    });
  }

  await seedBuiltinFactors();
  expect(await prisma.factor.findMany({ orderBy: { id: 'asc' } })).toEqual(initial);

  const changed = [BUILTIN_FACTORS[0], TIME_SERIES_TEMPLATES[0], PANEL_TEMPLATES[0]];
  for (const definition of changed) {
    const oldCode = `// Historical source for ${definition.key}`;
    await prisma.factor.update({
      where: { id: definition.key },
      data: {
        key: `old_${definition.key}`,
        name: 'Old preset',
        code: oldCode,
        codeHash: sha256(oldCode),
        status: 'archived',
        archivedAt: new Date('2020-01-01'),
        analysisKind: 'cross_sectional',
      },
    });
    await prisma.factorReport.create({
      data: {
        id: `historical-${definition.key}`,
        userId: 'fixture-owner',
        factor: definition.key,
        freq: 'month',
        start: '20200101',
        end: '20231229',
        factorCodeSnapshot: oldCode,
        factorCodeHash: sha256(oldCode),
        payload: JSON.stringify({ icMean: 0.125 }),
      },
    });
  }
  const historical = await prisma.factorReport.findMany({ orderBy: { id: 'asc' } });

  await seedBuiltinFactors();
  const refreshed = await prisma.factor.findMany({ orderBy: { id: 'asc' } });
  expect(refreshed).toHaveLength(initial.length);
  for (const row of initial) {
    const current = refreshed.find((candidate) => candidate.id === row.id);
    if (changed.some((definition) => definition.key === row.id)) {
      expect(current).toEqual({
        ...row,
        publishedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    } else {
      expect(current).toEqual(row);
    }
  }
  expect(await prisma.factorReport.findMany({ orderBy: { id: 'asc' } })).toEqual(historical);
});
