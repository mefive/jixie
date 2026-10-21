import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '#market/registry/index-presets.js';
import { TushareClient, type TushareRow } from '#market/providers/tushare/tushare-client.js';
import { auditWindowCoverage } from '#market/stocks/audit.js';

// 保留真实 repair → daily → 来源映射 → SQLite → 原始校验链路；其他数据域单独回归。
// Keep repair, daily, provider mapping, SQLite and raw validation real; regress other domains separately.
vi.mock('#market/providers/tushare/config.js', () => ({
  loadTushareConfig: () => ({ token: 'fixture', baseUrl: 'http://invalid', minIntervalMs: 1 }),
}));
vi.mock('#market/state/sync.js', () => ({ syncMarketIndicators: vi.fn(async () => {}) }));
vi.mock('#market/state/quality.js', () => ({
  validateDerivedMarketRange: vi.fn(async () => ({})),
}));
vi.mock('../publication/audit.js', async () => {
  const { auditStockUniverse } = await import('#market/instruments/audit.js');

  return {
    runDataQualityAudit: vi.fn(
      async (database: (typeof import('#infra/database/prisma.js'))['prisma']) => ({
        findings: [await auditStockUniverse(database)],
      }),
    ),
  };
});
vi.mock('#signals/daily/sync.js', () => ({
  prepareSignalEtfMarketDate: vi.fn(async () => ({})),
  syncSignalMarketData: vi.fn(async () => {}),
}));
vi.mock('#signals/daily/scheduler.js', () => ({ generateDailySignals: vi.fn() }));
vi.mock('#market/commodity/commodity-warehouse-receipt-maintenance.js', () => ({
  maintainCommodityWarehouseReceipts: vi.fn(async () => ({})),
}));
vi.mock('#market/commodity/holding-sync.js', () => ({
  refreshCommodityHoldingPositions: vi.fn(async () => ({})),
}));
vi.mock('#market/commodity/commodity-continuous-returns.js', () => ({
  syncCommodityContinuousReturns: vi.fn(async () => ({})),
}));
vi.mock('#market/cross-market/benchmark-sync.js', () => ({
  syncCrossMarketBenchmarks: vi.fn(async () => ({})),
}));
vi.mock('#market/cross-market/external-drivers.js', () => ({
  syncExternalMarketDrivers: vi.fn(async () => ({})),
}));
vi.mock('#market/rates/china-treasury-curve.js', () => ({
  MinistryOfFinanceCurveClient: class {},
  syncChinaTreasuryYieldCurve: vi.fn(async () => 0),
}));
vi.mock('#market/rates/chinabond-credit-curves.js', () => ({
  ChinaBondPublicCurveClient: class {},
  syncChinaBondCreditCurves: vi.fn(async () => 0),
}));

const tradeDates = ['20260813', '20260814'];
const oldCodes = [
  '000016.SH',
  '000300.SH',
  '000510.SH',
  '000688.SH',
  '000852.SH',
  '000905.SH',
  '000906.SH',
  '000922.CSI',
  '399006.SZ',
  '932000.CSI',
];
const industryCodes = Array.from(
  { length: 31 },
  (_, index) => `SW${String(index).padStart(3, '0')}`,
);
const requests: { api: string; parameters: Record<string, unknown> }[] = [];
let providerMode: 'complete' | 'empty' | 'future' | 'failure';
let directory: string;
let prisma: (typeof import('#infra/database/prisma.js'))['prisma'];
let runRepairMaintenance: (typeof import('./repair.js'))['runRepairMaintenance'];
let validateIndexWeightDate: (typeof import('#market/indices/daily-quality.js'))['validateIndexWeightDate'];
const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-repair-membership-'));
  const candidateDirectory = resolve(directory, 'maintenance-staging', 'CASE');
  await mkdir(candidateDirectory, { recursive: true });
  const candidateUrl = `file:${resolve(candidateDirectory, 'candidate.db')}`;
  await writeFile(resolve(directory, 'formal.db'), '');
  await writeFile(resolve(candidateDirectory, 'candidate.db'), '');
  vi.stubEnv('DATABASE_URL', candidateUrl);
  vi.stubEnv('JIXIE_STAGING_DATABASE', candidateUrl);
  vi.stubEnv('JIXIE_FORMAL_DATABASE_URL', `file:${resolve(directory, 'formal.db')}`);
  vi.stubEnv('JIXIE_MAINTENANCE_CANDIDATE', 'CASE');
  vi.stubEnv('JIXIE_MAINTENANCE_TIME', '2026-10-20T07:37:59.339Z');
  vi.stubEnv('JIXIE_MAINTENANCE_DATE', '20261020');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: apiDirectory,
    env: process.env,
    stdio: 'pipe',
  });
  ({ prisma } = await import('#infra/database/prisma.js'));
  ({ runRepairMaintenance } = await import('./repair.js'));
  ({ validateIndexWeightDate } = await import('#market/indices/daily-quality.js'));
}, 30_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  // Vitest 的 IPC 不是维护父进程，只拦截维护进度，保留测试框架自己的消息。
  // Vitest owns this IPC channel; intercept maintenance progress while retaining runner messages.
  const ipcProcess = process as NodeJS.Process & { send: NonNullable<NodeJS.Process['send']> };
  const send = ipcProcess.send.bind(ipcProcess);
  vi.spyOn(ipcProcess, 'send').mockImplementation((message, ...args) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'maintenance-progress'
    ) {
      return true;
    }

    return send(message, ...args);
  });
  providerMode = 'complete';
  requests.length = 0;
  await prisma.$transaction([
    prisma.maintenanceRun.deleteMany(),
    prisma.maintenanceCheckpoint.deleteMany(),
    prisma.indexWeight.deleteMany(),
    prisma.indexDaily.deleteMany(),
    prisma.indexDailyBasic.deleteMany(),
    prisma.swIndexDaily.deleteMany(),
    prisma.swIndustryMember.deleteMany(),
    prisma.tradeCal.deleteMany(),
    prisma.daily.deleteMany(),
    prisma.adjFactor.deleteMany(),
    prisma.dailyBasic.deleteMany(),
    prisma.stkLimit.deleteMany(),
    prisma.moneyflow.deleteMany(),
    prisma.topList.deleteMany(),
    prisma.maintenanceState.deleteMany(),
    prisma.stockBasic.deleteMany(),
    prisma.stockNameHistory.deleteMany(),
  ]);
  await prisma.maintenanceState.create({
    data: {
      key: 'global',
      dataRevision: 3,
      dailyPublishedThrough: '20260730',
    },
  });
  await prisma.indexWeight.createMany({
    data: oldCodes.map((indexCode) => ({
      indexCode,
      conCode: '000001.SZ',
      tradeDate: '20260630',
      weight: 100,
    })),
  });
  await prisma.swIndustryMember.createMany({
    data: industryCodes.map((l1Code, index) => ({
      tsCode: `FIXTURE${index}`,
      l1Code,
      l1Name: l1Code,
      inDate: '20200101',
    })),
  });
  vi.spyOn(TushareClient.prototype, 'call').mockImplementation(async (api, parameters = {}) => {
    requests.push({ api, parameters });
    return providerRows(api, parameters);
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

function providerRows(api: string, parameters: Record<string, unknown>): TushareRow[] {
  const tradeDate = String(parameters.trade_date ?? parameters.start_date ?? tradeDates[0]);
  const identity = { ts_code: String(parameters.ts_code ?? '000001.SZ'), trade_date: tradeDate };
  const bars = {
    ...identity,
    open: 10,
    high: 11,
    low: 9,
    close: 10,
    pre_close: 10,
    change: 0,
    pct_chg: 0,
    vol: 100,
    amount: 1000,
  };
  switch (api) {
    case 'stock_basic':
      if (parameters.list_status !== 'L' && parameters.list_status !== 'D') {
        return [];
      }
      return [
        {
          ts_code: parameters.list_status === 'L' ? '000001.SZ' : '600001.SH',
          symbol: parameters.list_status === 'L' ? '000001' : '600001',
          name: 'Fixture',
          list_status: String(parameters.list_status),
          list_date: '20200101',
          delist_date: parameters.list_status === 'D' ? '20250101' : null,
        },
      ];
    case 'namechange':
      return [
        {
          ts_code: '000001.SZ',
          name: 'Fixture',
          start_date: '20200101',
          end_date: null,
          ann_date: '20200101',
          change_reason: 'listing',
        },
      ];
    case 'trade_cal':
      return tradeDates
        .filter(
          (date) => date >= String(parameters.start_date) && date <= String(parameters.end_date),
        )
        .map((cal_date) => ({ exchange: 'SSE', cal_date, is_open: 1, pretrade_date: '20260730' }));
    case 'index_weight': {
      if (providerMode === 'failure') {
        throw new Error('Fixture provider failed');
      }
      const snapshot = providerMode === 'future' ? '20260814' : '20260731';
      if (
        providerMode === 'empty' ||
        snapshot < String(parameters.start_date) ||
        snapshot > String(parameters.end_date)
      ) {
        return [];
      }
      return [
        {
          index_code: String(parameters.index_code),
          con_code: '000001.SZ',
          trade_date: snapshot,
          weight: 100,
        },
      ];
    }
    case 'daily':
    case 'index_daily':
      return [bars];
    case 'adj_factor':
      return [{ ...identity, adj_factor: 1 }];
    case 'daily_basic':
    case 'index_dailybasic':
      return [{ ...identity, pe: 10, pb: 1, total_mv: 100, circ_mv: 100, turnover_rate_f: 2 }];
    case 'stk_limit':
      return [{ ...identity, up_limit: 11, down_limit: 9 }];
    case 'moneyflow':
      return [{ ...identity, net_mf_amount: 0 }];
    case 'top_list':
      return [];
    case 'index_classify':
      return industryCodes.map((index_code) => ({
        index_code,
        industry_name: index_code,
        level: 'L1',
      }));
    case 'sw_daily':
      return industryCodes.map((ts_code) => ({ ...bars, ts_code, name: ts_code, pct_change: 0 }));
    default:
      throw new Error(`Unexpected fixture API ${api}`);
  }
}

describe('repair index prerequisites against migrated SQLite', () => {
  it('fills the missing 24 universes before real refresh/daily validation and preserves the publication watermark', async () => {
    await expect(validateIndexWeightDate(tradeDates[0])).rejects.toThrow(
      'no point-in-time snapshot',
    );
    await runRepairMaintenance(tradeDates[0], tradeDates[1], true);
    expect(await prisma.indexWeight.groupBy({ by: ['indexCode'] })).toHaveLength(
      MARKET_WEATHER_INDICATOR_INDEX_CODES.length,
    );
    expect(await prisma.daily.count()).toBe(2);
    expect(await prisma.stockBasic.count({ where: { listStatus: 'D' } })).toBe(1);
    expect(await prisma.stockNameHistory.count({ where: { tsCode: '000001.SZ' } })).toBeGreaterThan(
      0,
    );
    expect(await prisma.maintenanceRun.findMany({ select: { kind: true, status: true } })).toEqual(
      expect.arrayContaining([
        { kind: 'repair', status: 'done' },
        { kind: 'daily', status: 'done' },
      ]),
    );
    expect(await prisma.maintenanceRun.count({ where: { kind: 'daily', status: 'done' } })).toBe(2);
    expect(await prisma.maintenanceState.findUnique({ where: { key: 'global' } })).toMatchObject({
      dailyPublishedThrough: '20260730',
    });
    const lastMembership = requests.map((request) => request.api).lastIndexOf('index_weight');
    expect(lastMembership).toBeLessThan(requests.findIndex((request) => request.api === 'daily'));
    expect(
      requests
        .filter((request) => request.api === 'index_weight')
        .some((request) => String(request.parameters.start_date) < tradeDates[0]),
    ).toBe(true);
  });

  it('prepares the same prerequisites for gap-only repair', async () => {
    await runRepairMaintenance(tradeDates[0], tradeDates[1]);
    expect(await prisma.daily.count()).toBe(2);
    expect(await prisma.maintenanceRun.findFirst({ where: { kind: 'repair' } })).toMatchObject({
      status: 'done',
    });
  });

  it.each(['empty', 'future', 'failure'] as const)(
    'rejects %s provider data before daily downloads',
    async (mode) => {
      providerMode = mode;
      await expect(runRepairMaintenance(tradeDates[0], tradeDates[1], true)).rejects.toThrow(
        mode === 'failure' ? 'Fixture provider failed' : 'no fresh as-of snapshot',
      );
      expect(requests.some((request) => request.api === 'daily')).toBe(false);
      expect(await prisma.maintenanceRun.findFirst({ where: { kind: 'repair' } })).toMatchObject({
        status: 'error',
      });
      expect(await prisma.maintenanceState.findUnique({ where: { key: 'global' } })).toMatchObject({
        dataRevision: 3,
        dailyPublishedThrough: '20260730',
      });
    },
  );

  it('rejects stale snapshots using the configured publication policy', async () => {
    providerMode = 'empty';
    await prisma.indexWeight.createMany({
      data: MARKET_WEATHER_INDICATOR_INDEX_CODES.filter(
        (indexCode) => !oldCodes.includes(indexCode),
      ).map((indexCode) => ({
        indexCode,
        conCode: '000001.SZ',
        tradeDate: '20260731',
        weight: 100,
      })),
    });
    vi.stubEnv('MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS', '5');
    try {
      await expect(runRepairMaintenance(tradeDates[0], tradeDates[1], true)).rejects.toThrow(
        'no fresh as-of snapshot',
      );
      expect(requests.some((request) => request.api === 'daily')).toBe(false);
    } finally {
      delete process.env.MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS;
    }
  });

  it('audits a short requested range against sixty real preceding sessions', async () => {
    const calendar = Array.from(
      { length: 100 },
      (_, index) => new Date(Date.UTC(2026, 7, 14 - (99 - index))),
    )
      .filter((date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      .slice(-61)
      .map((date) => date.toISOString().slice(0, 10).replaceAll('-', ''));
    await prisma.tradeCal.createMany({
      data: calendar.map((calDate) => ({ exchange: 'SSE', calDate, isOpen: 1 })),
    });
    await prisma.daily.createMany({
      data: calendar.map((tradeDate) => ({ tsCode: '000001.SZ', tradeDate, close: 10 })),
    });
    const finding = await auditWindowCoverage(prisma, ['20260814'], 60, 1);
    expect(finding.status).toBe('pass');
    expect(finding.details[0]).toContain('n=1');
    expect(finding.details[0]).toContain(`${calendar[1]}..20260814`);
  });

  it('keeps the window audit failing when sixty sessions really are unavailable', async () => {
    await prisma.tradeCal.createMany({
      data: tradeDates.map((calDate) => ({ exchange: 'SSE', calDate, isOpen: 1 })),
    });
    expect((await auditWindowCoverage(prisma, tradeDates, 60, 1)).status).toBe('error');
  });
});
