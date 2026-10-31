import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

it('adds an unknown exchange without rewriting legacy catalog rows', async () => {
  const directory = await mkdtemp('/tmp/jixie-stock-exchange-test-');
  const file = join(directory, 'upgrade.db');
  const database = new prismaPackage.PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    // 旧 schema 夹具刻意不使用带新列的当前客户端创建。
    // Create the legacy fixture independently of the client that already knows the new column.
    execFileSync('sqlite3', [file], {
      input: `
      CREATE TABLE StockBasic (
        tsCode TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL,
        area TEXT, market TEXT, listDate TEXT, delistDate TEXT, listStatus TEXT NOT NULL
      );
      INSERT INTO StockBasic VALUES ('900901.BJ', '900901', 'Source identity', NULL, NULL, '19900101', NULL, 'L');
      INSERT INTO StockBasic VALUES ('000594.SZ', '000594', 'Delisted', NULL, NULL, '19960320', '20150713', 'D');
    `,
    });
    const migration = await readFile(
      resolve('prisma/migrations/20261031083330_add_stock_exchange/migration.sql'),
      'utf8',
    );
    execFileSync('sqlite3', [file], { input: migration });

    const rows = await database.stockBasic.findMany({ orderBy: { tsCode: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows).toMatchObject([
      {
        tsCode: '000594.SZ',
        listDate: '19960320',
        delistDate: '20150713',
        listStatus: 'D',
        exchange: null,
      },
      {
        tsCode: '900901.BJ',
        name: 'Source identity',
        listDate: '19900101',
        listStatus: 'L',
        exchange: null,
      },
    ]);
    await database.stockBasic.update({ where: { tsCode: '900901.BJ' }, data: { exchange: 'SSE' } });
    expect(await database.stockBasic.findUnique({ where: { tsCode: '900901.BJ' } })).toMatchObject({
      tsCode: '900901.BJ',
      exchange: 'SSE',
    });
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
