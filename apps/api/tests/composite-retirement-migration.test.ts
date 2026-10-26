import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';
import { withDatabase } from '#infra/database/prisma.js';
import { readFactorReport, listFactorReports } from '#factor/evaluations/read.js';
import { loadResearchFactorReportResult } from '#research/datasets/results/factor-report.js';
import { searchResearchDataCatalog } from '#research/catalog/data-catalog.js';

const retirement = '20261026180000_remove_composite_factors';

it('drops composites and correlation caches while preserving independent versions and rejecting legacy reports', async () => {
  const directory = await mkdtemp('/tmp/jixie-composite-retirement-');
  const databaseUrl = `file:${directory}/upgrade.db`;
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const database = new prismaPackage.PrismaClient({ datasourceUrl: databaseUrl });
  const deploy = () =>
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        schema,
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
    );
  const source = 'export default defineFactor({ name: "Published", compute: () => 1 });';

  try {
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    for (const name of await readdir(resolve('prisma/migrations'))) {
      if (name < retirement || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    deploy();

    await database.user.create({
      data: { id: 'owner', email: 'composite-upgrade@fixture.invalid' },
    });
    await database.factorReport.create({
      data: {
        id: 'approved',
        userId: 'owner',
        factor: 'published',
        legacyStatus: 'done',
        freq: 'month',
        start: '20240101',
        end: '20241231',
        factorCodeSnapshot: source,
        factorCodeHash: 'published-hash',
        payload: JSON.stringify({ icMean: 0.1 }),
      },
    });
    await database.factor.create({
      data: {
        id: 'published',
        userId: 'owner',
        key: 'published_version',
        name: 'Published',
        status: 'published',
        code: source,
        approvedReportId: 'approved',
        codeHash: 'published-hash',
        publishedAt: new Date('2025-01-01'),
      },
    });
    await database.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Consumer',
        config: { code: 'consume published_version', factors: ['published_version'] },
      },
    });
    await database.agentConversation.create({
      data: { id: 'conversation', userId: 'owner', factorId: 'published', surface: 'factor' },
    });

    // 在隔离旧库中构造组合与缓存；新 Client 已没有这些模型。
    // Seed retired definitions and caches in the isolated old schema; the new client omits these models.
    await database.$executeRaw`INSERT INTO FactorComposite
      (id,userId,name,definition,status,key,approvedReportId,codeHash,updatedAt)
      VALUES ('old-composite','owner','Old composite','{}','published','old_composite','old-report','old-hash',CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO FactorCorrelation (id,userId,payload,computedAt)
      VALUES ('cache','owner','{}',CURRENT_TIMESTAMP)`;
    await database.factorReport.createMany({
      data: [
        {
          id: 'old-report',
          userId: 'owner',
          factor: 'old-composite',
          legacyStatus: 'done',
          freq: 'month',
          start: '20240101',
          end: '20241231',
          specJson: JSON.stringify({ version: 4, composite: {} }),
          payload: '{}',
        },
        {
          id: 'old-panel-report',
          userId: 'owner',
          factor: 'old-panel',
          legacyStatus: 'done',
          analysisKind: 'panel',
          freq: 'month',
          start: '20240101',
          end: '20241231',
          factorCodeSnapshot: JSON.stringify({ kind: 'panel_composite', components: [] }),
          payload: '{}',
        },
      ],
    });
    await database.agentConversation.create({
      data: {
        id: 'research',
        userId: 'owner',
        surface: 'research',
        researchDocument: { create: { id: 'research', userId: 'owner' } },
      },
    });

    const snapshot = () =>
      Promise.all([
        database.user.findMany(),
        database.factor.findMany(),
        database.factorReport.findMany(),
        database.strategy.findMany(),
        database.agentConversation.findMany(),
        database.$queryRaw<Array<{ name: string; sql: string }>>`
          SELECT name,sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'FactorComposite%' AND name NOT LIKE 'FactorCorrelation%'
          ORDER BY name`,
      ]);
    const before = await snapshot();

    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    expect(
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name LIKE 'FactorComposite%' OR name LIKE 'FactorCorrelation%'`,
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    await withDatabase(database, async () => {
      for (const reportId of ['old-report', 'old-panel-report']) {
        await expect(readFactorReport('owner', reportId)).rejects.toMatchObject({
          reason: 'evaluation_not_found',
        });
        await expect(loadResearchFactorReportResult('research', reportId)).rejects.toMatchObject({
          reason: 'evaluation_not_found',
        });
      }
      expect(await listFactorReports('owner', { factor: 'old-composite' })).toEqual({ items: [] });
      expect(
        (
          await searchResearchDataCatalog({ userId: 'owner', scope: 'factor_reports' })
        ).factorReports.map((report) => report.id),
      ).toEqual(['approved']);
      expect((await readFactorReport('owner', 'approved')).factorCodeSnapshot).toBe(source);
    });
    expect(await database.factor.findUnique({ where: { id: 'published' } })).toMatchObject({
      code: source,
      approvedReportId: 'approved',
      status: 'published',
    });
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
