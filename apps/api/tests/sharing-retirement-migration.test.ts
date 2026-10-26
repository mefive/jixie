import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

const retirement = '20261025130000_remove_sharing';

it('removes visibility without changing resource owners, code, versions, reports or conversations', async () => {
  const directory = await mkdtemp('/tmp/jixie-sharing-retirement-');
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

    for (const visibility of ['public', 'private']) {
      const userId = `owner:${visibility}`;
      const factorId = `factor:${visibility}`;
      const reportId = `report:${visibility}`;
      const strategyId = `strategy:${visibility}`;

      await database.user.create({ data: { id: userId, email: `${visibility}@fixture.invalid` } });
      await database.factorReport.create({
        data: {
          id: reportId,
          userId,
          factor: factorId,
          freq: 'month',
          start: '20240101',
          end: '20241231',
          legacyStatus: 'done',
          factorCodeSnapshot: 'frozen source',
          factorCodeHash: 'code-hash',
          payload: JSON.stringify({ icMean: 0.1 }),
        },
      });
      await database.factor.create({
        data: {
          id: factorId,
          userId,
          key: 'fixed_version',
          name: 'Kept factor',
          code: 'frozen source',
          status: 'published',
          approvedReportId: reportId,
          codeHash: 'code-hash',
          publishedAt: new Date('2025-01-01'),
          messages: [{ role: 'user', content: 'Kept authoring history' }],
        },
      });

      const compositeReportId = `composite-report:${visibility}`;
      await database.factorReport.create({
        data: {
          id: compositeReportId,
          userId,
          factor: `composite:${visibility}`,
          freq: 'month',
          start: '20240101',
          end: '20241231',
          legacyStatus: 'done',
          payload: JSON.stringify({ componentIds: [factorId] }),
        },
      });
      const definition = JSON.stringify({ version: 2, components: [{ factor: factorId }] });
      await database.$executeRaw`INSERT INTO FactorComposite
        (id,userId,key,name,status,definition,approvedReportId,codeHash,updatedAt)
        VALUES (${'composite:' + visibility},${userId},'fixed_composite','Kept composite','published',${definition},${compositeReportId},'composite-hash',CURRENT_TIMESTAMP)`;

      await database.strategy.create({
        data: {
          id: strategyId,
          userId,
          name: 'Kept strategy',
          config: { code: 'kept strategy source' },
          messages: [{ role: 'user', content: 'Kept strategy history' }],
        },
      });
      await database.$executeRaw`UPDATE Strategy SET lastResult = '{"trades":2}' WHERE id = ${strategyId}`;
      await database.backtestReport.create({
        data: {
          id: `backtest:${visibility}`,
          userId,
          strategyId,
          strategyName: 'Kept strategy',
          settings: { code: 'kept strategy source' },
          payload: { trades: 2 },
        },
        select: { id: true },
      });
      await database.agentConversation.create({
        data: {
          id: `conversation:${visibility}`,
          userId,
          factorId,
          surface: 'factor',
          title: 'Kept conversation',
        },
      });

      // 新 Client 已无该字段；旧库中的两种可见范围都必须完整保留其余数据。
      // The new client omits this field; both legacy visibility values must preserve all other data.
      await database.$executeRaw`UPDATE Strategy SET visibility = ${visibility} WHERE id = ${strategyId}`;
      await database.$executeRaw`UPDATE Factor SET visibility = ${visibility} WHERE id = ${factorId}`;
      await database.$executeRaw`UPDATE FactorComposite SET visibility = ${visibility} WHERE id = ${`composite:${visibility}`}`;
    }

    const snapshot = () =>
      Promise.all([
        database.user.findMany({ orderBy: { id: 'asc' } }),
        database.$queryRaw`SELECT id, userId, name, config, lastResult, messages, createdAt, updatedAt FROM Strategy ORDER BY id`,
        database.factor.findMany({ orderBy: { id: 'asc' } }),
        database.$queryRaw`SELECT id,userId,key,name,definition,status,approvedReportId,codeHash,publishedAt,archivedAt,createdAt,updatedAt FROM FactorComposite ORDER BY id`,
        database.factorReport.findMany({ orderBy: { id: 'asc' } }),
        database.backtestReport.findMany({
          orderBy: { id: 'asc' },
          select: {
            id: true,
            userId: true,
            strategyId: true,
            strategyName: true,
            settings: true,
            payload: true,
            legacyStatus: true,
            legacyError: true,
          },
        }),
        database.agentConversation.findMany({ orderBy: { id: 'asc' } }),
      ]);
    const before = await snapshot();

    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);

    for (const table of ['Strategy', 'Factor', 'FactorComposite']) {
      const columns = await database.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`,
      );
      expect(columns.some((column) => column.name === 'visibility')).toBe(false);
    }

    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    await expect(database.factor.delete({ where: { id: 'factor:public' } })).resolves.toBeDefined();
    expect(await database.factorReport.count()).toBe(4);
    expect(
      await database.agentConversation.findUnique({ where: { id: 'conversation:public' } }),
    ).toBeNull();

    await database.strategy.delete({ where: { id: 'strategy:public' } });
    expect(
      await database.backtestReport.findUnique({
        where: { id: 'backtest:public' },
        select: { id: true },
      }),
    ).toBeNull();
    expect(await database.factor.findUnique({ where: { id: 'factor:private' } })).not.toBeNull();
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
