import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import prismaPackage from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadResearchCrossSection, loadResearchPanel } from './equity-dataset.js';

const { PrismaClient: RuntimePrismaClient } = prismaPackage;

describe('Research equity datasets', () => {
  let temporaryDirectory: string;
  let database: PrismaClient;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'jixie-research-equity-dataset-'));
    database = new RuntimePrismaClient({
      datasourceUrl: `file:${join(temporaryDirectory, 'dataset.db')}`,
    });
    await createFixtureSchema(database);
    await seedFixture(database);
  });

  afterEach(async () => {
    await database.$disconnect();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('loads a fixed-schema point-in-time index cross-section without current-name leakage', async () => {
    const result = await loadResearchCrossSection(
      {
        universe: 'index:000300.SH',
        date: '20240203',
        minimum_listed_days: 0,
        risk_warning: 'exclude',
      },
      database,
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        date: '20240131',
        code: 'AAA.SH',
        name: 'Alpha',
        industry: 'Bank',
        close: 10,
        adjusted_close: 12,
        amount_cny_1k: 1_000,
        pe_ttm: 8,
      }),
    ]);
    expect(result.metadata).toMatchObject({
      kind: 'cross_section',
      dataRevision: 7,
      rowCount: 1,
      periods: [
        {
          requestedDate: '20240203',
          dataDate: '20240131',
          membershipAsOfDate: '20240131',
          rows: 1,
        },
      ],
    });
    expect(result.metadata.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'UNIVERSE_PREVIOUS_TRADING_DAY',
    );
  });

  it("builds completed month ends with each date's historical index membership", async () => {
    const result = await loadResearchPanel(
      {
        universe: 'index:000300.SH',
        start: '20240101',
        end: '20240315',
        frequency: 'month_end',
        minimum_listed_days: 0,
        risk_warning: 'include',
      },
      database,
    );

    expect(result.rows.map((row) => `${row.date}:${row.code}`)).toEqual([
      '20240131:AAA.SH',
      '20240131:BBB.SH',
      '20240229:BBB.SH',
      '20240229:CCC.SH',
    ]);
    expect(
      result.rows.find((row) => row.date === '20240229' && row.code === 'BBB.SH'),
    ).toMatchObject({ name: 'Beta', adjusted_close: 24 });
    expect(result.metadata).toMatchObject({
      kind: 'panel',
      rowCount: 4,
      periods: [
        { requestedDate: '20240131', membershipAsOfDate: '20240131', rows: 2 },
        { requestedDate: '20240229', membershipAsOfDate: '20240229', rows: 2 },
      ],
    });
  });
});

async function createFixtureSchema(database: PrismaClient): Promise<void> {
  const statements = [
    `CREATE TABLE "DailyBasic" (
      "tsCode" TEXT NOT NULL,
      "tradeDate" TEXT NOT NULL,
      "pe" REAL,
      "peTtm" REAL,
      "pb" REAL,
      "ps" REAL,
      "psTtm" REAL,
      "dvRatio" REAL,
      "dvTtm" REAL,
      "totalMv" REAL,
      "circMv" REAL,
      "turnoverRate" REAL,
      "turnoverRateF" REAL,
      PRIMARY KEY ("tsCode", "tradeDate")
    )`,
    `CREATE TABLE "Daily" (
      "tsCode" TEXT NOT NULL,
      "tradeDate" TEXT NOT NULL,
      "open" REAL,
      "high" REAL,
      "low" REAL,
      "close" REAL,
      "preClose" REAL,
      "pctChg" REAL,
      "vol" REAL,
      "amount" REAL,
      PRIMARY KEY ("tsCode", "tradeDate")
    )`,
    `CREATE TABLE "AdjFactor" (
      "tsCode" TEXT NOT NULL,
      "tradeDate" TEXT NOT NULL,
      "adjFactor" REAL NOT NULL,
      PRIMARY KEY ("tsCode", "tradeDate")
    )`,
    `CREATE TABLE "StockBasic" (
      "tsCode" TEXT NOT NULL PRIMARY KEY,
      "symbol" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "area" TEXT,
      "industry" TEXT,
      "market" TEXT,
      "listDate" TEXT,
      "delistDate" TEXT,
      "listStatus" TEXT NOT NULL
    )`,
    `CREATE TABLE "StockNameHistory" (
      "tsCode" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "startDate" TEXT NOT NULL,
      "endDate" TEXT,
      "announcementDate" TEXT,
      "changeReason" TEXT,
      PRIMARY KEY ("tsCode", "startDate")
    )`,
    `CREATE TABLE "SwIndustryMember" (
      "tsCode" TEXT NOT NULL,
      "l1Code" TEXT NOT NULL,
      "l1Name" TEXT NOT NULL,
      "inDate" TEXT NOT NULL,
      "outDate" TEXT,
      PRIMARY KEY ("tsCode", "l1Code", "inDate")
    )`,
    `CREATE TABLE "IndexWeight" (
      "indexCode" TEXT NOT NULL,
      "conCode" TEXT NOT NULL,
      "tradeDate" TEXT NOT NULL,
      "weight" REAL,
      PRIMARY KEY ("indexCode", "conCode", "tradeDate")
    )`,
    `CREATE TABLE "TradeCal" (
      "exchange" TEXT NOT NULL,
      "calDate" TEXT NOT NULL,
      "isOpen" INTEGER NOT NULL,
      "pretradeDate" TEXT,
      PRIMARY KEY ("exchange", "calDate")
    )`,
    `CREATE TABLE "MaintenanceState" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "dailyPublishedThrough" TEXT,
      "weeklySyncedThrough" TEXT,
      "dataRevision" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const statement of statements) {
    await database.$executeRawUnsafe(statement);
  }
}

async function seedFixture(database: PrismaClient): Promise<void> {
  await database.stockBasic.createMany({
    data: [stock('AAA.SH', 'Alpha'), stock('BBB.SH', 'Beta'), stock('CCC.SH', 'Gamma')],
  });
  await database.stockNameHistory.createMany({
    data: [
      { tsCode: 'AAA.SH', name: 'Alpha', startDate: '20200101' },
      { tsCode: 'BBB.SH', name: 'ST Beta', startDate: '20200101', endDate: '20240215' },
      { tsCode: 'BBB.SH', name: 'Beta', startDate: '20240216' },
      { tsCode: 'CCC.SH', name: 'Gamma', startDate: '20200101' },
    ],
  });
  await database.swIndustryMember.createMany({
    data: [
      industry('AAA.SH', 'Bank'),
      industry('BBB.SH', 'Technology'),
      industry('CCC.SH', 'Industrial'),
    ],
  });
  await database.indexWeight.createMany({
    data: [
      { indexCode: '000300.SH', conCode: 'AAA.SH', tradeDate: '20240131' },
      { indexCode: '000300.SH', conCode: 'BBB.SH', tradeDate: '20240131' },
      { indexCode: '000300.SH', conCode: 'BBB.SH', tradeDate: '20240229' },
      { indexCode: '000300.SH', conCode: 'CCC.SH', tradeDate: '20240229' },
    ],
  });
  await database.tradeCal.createMany({
    data: [
      { exchange: 'SSE', calDate: '20240131', isOpen: 1 },
      { exchange: 'SSE', calDate: '20240229', isOpen: 1 },
      { exchange: 'SSE', calDate: '20240315', isOpen: 1 },
    ],
  });
  await database.dailyBasic.createMany({
    data: [
      dailyBasic('AAA.SH', '20240131', 8, 100),
      dailyBasic('BBB.SH', '20240131', 12, 200),
      dailyBasic('BBB.SH', '20240229', 11, 220),
      dailyBasic('CCC.SH', '20240229', 15, 180),
    ],
  });
  await database.daily.createMany({
    data: [
      daily('AAA.SH', '20240131', 10, 1_000),
      daily('BBB.SH', '20240131', 20, 2_000),
      daily('BBB.SH', '20240229', 20, 2_100),
      daily('CCC.SH', '20240229', 30, 1_800),
    ],
  });
  await database.adjFactor.createMany({
    data: [
      { tsCode: 'AAA.SH', tradeDate: '20240131', adjFactor: 1.2 },
      { tsCode: 'BBB.SH', tradeDate: '20240131', adjFactor: 1.1 },
      { tsCode: 'BBB.SH', tradeDate: '20240229', adjFactor: 1.2 },
      { tsCode: 'CCC.SH', tradeDate: '20240229', adjFactor: 1.1 },
    ],
  });
  await database.maintenanceState.create({ data: { key: 'global', dataRevision: 7 } });
}

function stock(tsCode: string, name: string) {
  return {
    tsCode,
    symbol: tsCode.split('.')[0]!,
    name,
    listDate: '20100101',
    listStatus: 'L',
  };
}

function industry(tsCode: string, l1Name: string) {
  return { tsCode, l1Code: `I-${tsCode}`, l1Name, inDate: '20200101' };
}

function dailyBasic(tsCode: string, tradeDate: string, peTtm: number, totalMv: number) {
  return {
    tsCode,
    tradeDate,
    pe: peTtm,
    peTtm,
    pb: 1,
    ps: 2,
    dvRatio: 3,
    totalMv,
    circMv: totalMv * 0.8,
    turnoverRate: 1.5,
  };
}

function daily(tsCode: string, tradeDate: string, close: number, amount: number) {
  return { tsCode, tradeDate, close, pctChg: 1, vol: 100, amount };
}
