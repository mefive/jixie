import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

const retirement = '20261025143000_remove_research_curator';

it('removes Curator data while retaining research, factors, backtests, market data and Job history', async () => {
  const directory = await mkdtemp('/tmp/jixie-curator-retirement-');
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

  try {
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    const names = await readdir(resolve('prisma/migrations'));
    expect(names).toContain(retirement);

    for (const name of names) {
      if (name < retirement || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }

    deploy();
    await database.user.create({ data: { id: 'owner', email: 'curator-retired@fixture.invalid' } });
    await database.agentConversation.create({
      data: { id: 'conversation', userId: 'owner', surface: 'research', title: 'Kept history' },
    });
    await database.researchDocument.create({
      data: { id: 'document', userId: 'owner', conversationId: 'conversation' },
    });
    await database.researchCell.create({
      data: {
        id: 'cell',
        documentId: 'document',
        position: 0,
        kind: 'python',
        source: '42',
        definitions: [],
        references: [],
      },
    });
    await database.factorReport.create({
      data: {
        id: 'factor-report',
        userId: 'owner',
        factor: 'factor',
        freq: 'month',
        start: '20240101',
        end: '20241231',
        legacyStatus: 'done',
        factorCodeSnapshot: 'frozen source',
        factorCodeHash: 'hash',
        payload: '{"icMean":0.1}',
      },
    });
    await database.factor.create({
      data: {
        id: 'factor',
        userId: 'owner',
        key: 'fixed_version',
        name: 'Kept factor',
        code: 'frozen source',
        status: 'published',
        codeHash: 'hash',
        approvedReportId: 'factor-report',
      },
    });
    await database.strategy.create({
      data: { id: 'strategy', userId: 'owner', name: 'Kept strategy', config: { code: 'source' } },
    });
    await database.backtestReport.create({
      data: {
        id: 'backtest',
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Kept strategy',
        config: { code: 'source' },
        payload: { trades: 2 },
      },
    });
    await database.daily.create({ data: { tsCode: 'fixture', tradeDate: '20240102', close: 10 } });
    await database.tushareCapabilityProbe.create({
      data: {
        id: 'probe',
        catalogVersion: 1,
        apiName: 'daily',
        domain: 'stocks',
        probeDate: '20240102',
        status: 'ok',
        rowCount: 1,
        fields: ['ts_code', 'trade_date', 'close'],
        probedAt: new Date('2024-01-03'),
      },
    });

    // 新 Client 已无 Curator 模型；通过固定旧表夹具覆盖有数据的升级。
    // The new client omits Curator models; fixed legacy-table fixtures cover populated upgrades.
    await database.$executeRaw`
      INSERT INTO ResearchCuratorRun (id, userId, cursorTo, status, updatedAt)
      VALUES ('curator-run', 'owner', ${new Date(0)}, 'done', ${new Date(0)})
    `;
    await database.$executeRaw`
      INSERT INTO ResearchCuratorFinding
        (id, userId, runId, category, title, summary, evidence, verification,
         confidence, expectedValue, changeSurface, suggestedAction, fingerprint, updatedAt)
      VALUES ('finding', 'owner', 'curator-run', 'documentation_gap', 'Old suggestion',
        'Old summary', '[]', '{}', 0.8, 'Old value', '[]', 'Review', 'fingerprint', ${new Date(0)})
    `;
    for (const status of ['done', 'queued']) {
      const id = `curator-job:${status}`;
      await database.job.create({
        data: {
          id,
          userId: 'owner',
          kind: 'research-curator',
          key: status,
          status,
          payload: { runId: 'curator-run' },
          logs: '[]',
        },
      });
    }
    await database.$executeRaw`
      UPDATE Job SET researchCuratorRunId = 'curator-run' WHERE id = 'curator-job:done'
    `;

    const snapshot = () =>
      Promise.all([
        database.user.findMany(),
        database.agentConversation.findMany(),
        database.researchDocument.findMany(),
        database.researchCell.findMany(),
        database.factor.findMany(),
        database.factorReport.findMany(),
        database.strategy.findMany(),
        database.backtestReport.findMany(),
        database.daily.findMany(),
        database.tushareCapabilityProbe.findMany(),
        database.job.findMany({ orderBy: { id: 'asc' } }),
      ]);
    const before = await snapshot();

    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    const tables = await database.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ResearchCurator%'
    `;
    expect(tables).toEqual([]);
    const columns = await database.$queryRaw<Array<{ name: string }>>`PRAGMA table_info("Job")`;
    expect(columns.some((column) => column.name === 'researchCuratorRunId')).toBe(false);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);

    await database.strategy.delete({ where: { id: 'strategy' } });
    expect(await database.backtestReport.count()).toBe(0);
    expect(await database.job.count()).toBe(2);
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
