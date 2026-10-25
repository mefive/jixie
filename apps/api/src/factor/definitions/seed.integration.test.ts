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
  const mocked = { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

import { prisma } from '#infra/database/prisma.js';
import { sha256 } from '../sources/fingerprint.js';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from './builtin-factors.js';
import { resolveFactorSource, resolveTimeSeriesFactorSource } from '../sources/resolve.js';
import { resolvePanelFactorSource } from '../composition/panel-source.js';
import { captureFactorQuestionContext } from '../questions/context.js';
import { captureEmbeddedContext } from '#research/embedded/context.js';
import { readFactorDefinition } from './read.js';
import { listFactorCatalog } from './catalog.js';
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

it('seeds missing presets and preserves saved versions across initialization and all source consumers', async () => {
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

  const savedVersions = [BUILTIN_FACTORS[0], TIME_SERIES_TEMPLATES[0], PANEL_TEMPLATES[0]];
  for (const [index, definition] of savedVersions.entries()) {
    const oldCode = `// Saved source for ${definition.key}\n${definition.code}`;
    await prisma.factorReport.create({
      data: {
        id: `bound-${definition.key}`,
        userId: 'fixture-owner',
        factor: definition.key,
        legacyStatus: 'done',
        freq: 'month',
        start: '20200101',
        end: '20231229',
        factorCodeSnapshot: oldCode,
        factorCodeHash: sha256(oldCode),
        payload: JSON.stringify({ icMean: 0.125 }),
      },
    });
    await prisma.factor.update({
      where: { id: definition.key },
      data: {
        key: `saved_${definition.key}`,
        name: 'Saved preset',
        code: oldCode,
        codeHash: sha256(oldCode),
        approvedReportId: `bound-${definition.key}`,
        status: index === 0 ? 'archived' : 'published',
        publishedAt: new Date('2020-01-01'),
        archivedAt: index === 0 ? new Date('2021-01-01') : null,
      },
    });
  }
  const saved = await prisma.factor.findMany({ orderBy: { id: 'asc' } });
  const reports = await prisma.factorReport.findMany({ orderBy: { id: 'asc' } });

  await seedBuiltinFactors();
  expect(await prisma.factor.findMany({ orderBy: { id: 'asc' } })).toEqual(saved);
  expect(await prisma.factorReport.findMany({ orderBy: { id: 'asc' } })).toEqual(reports);

  const resolvers = [resolveFactorSource, resolveTimeSeriesFactorSource, resolvePanelFactorSource];
  for (const [index, definition] of savedVersions.entries()) {
    const stored = saved.find((row) => row.id === definition.key)!;
    expect(await resolvers[index]('fixture-owner', definition.key)).toMatchObject({
      code: stored.code,
    });
    expect(await readFactorDefinition('fixture-owner', definition.key, 'en')).toMatchObject({
      code: stored.code,
      codeHash: stored.codeHash,
      key: stored.key,
      status: stored.status,
      approvedReportId: stored.approvedReportId,
    });
    expect(
      (await captureFactorQuestionContext(prisma, 'fixture-owner', definition.key, undefined, 'en'))
        .factor.source,
    ).toBe(stored.code);
    expect(
      (
        await captureEmbeddedContext(prisma, 'fixture-owner', {
          type: 'factor',
          id: definition.key,
        })
      ).code,
    ).toBe(stored.code);
  }
  const catalog = await listFactorCatalog('fixture-owner', 'en');
  for (const definition of savedVersions) {
    const stored = saved.find((row) => row.id === definition.key)!;
    expect(catalog.find((entry) => entry.key === definition.key)).toMatchObject({
      status: stored.status,
    });
  }

  const missing = BUILTIN_FACTORS[1];
  await prisma.factor.delete({ where: { id: missing.key } });
  await seedBuiltinFactors();
  expect(await prisma.factor.findUnique({ where: { id: missing.key } })).toMatchObject({
    code: missing.code,
    status: 'published',
    codeHash: sha256(missing.code),
  });
});
