import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

const retirement = '20261026160000_remove_factor_weather';

it('drops weather observations while preserving published factor versions and all other tables', async () => {
  const directory = await mkdtemp('/tmp/jixie-factor-weather-retirement-');
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

    await database.user.create({ data: { id: 'owner', email: 'weather-upgrade@fixture.invalid' } });
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

    // 新 Client 不再包含天气模型；仅在隔离旧库中构造待删除历史记录。
    // The new client omits weather models; seed retired history only in the isolated legacy database.
    await database.$executeRaw`INSERT INTO FactorWeatherPin
      (id,userId,factorId,factorName,builtin,direction,factorCode,factorCodeHash,methodologyHash,status,updatedAt)
      VALUES ('pin','owner','published','Published',0,'positive',${source},'published-hash','monthly','running',CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO FactorWeatherPoint
      (pinId,formationDate,periodEndDate,rankIc,topReturn,bottomReturn,longShortGrossReturn,longShortNetReturn,sampleSize,sampleCoverage)
      VALUES ('pin','20240131','20240229',0.1,0.04,-0.01,0.05,0.045,300,0.95)`;

    const snapshot = () =>
      Promise.all([
        database.user.findMany(),
        database.factor.findMany(),
        database.factorReport.findMany(),
        database.strategy.findMany(),
        database.agentConversation.findMany(),
        database.$queryRaw<Array<{ name: string; sql: string }>>`
          SELECT name,sql FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'FactorWeather%'
          ORDER BY name`,
      ]);
    const before = await snapshot();

    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    expect(
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name LIKE 'FactorWeather%'`,
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
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
