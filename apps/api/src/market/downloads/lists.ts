import { INDEX_VALUATION_SUPPORTED_CODES } from '../registry/index-presets.js';
import { z } from 'zod';
import { getDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock, withMarketPublication } from '#infra/coordination/market-access.js';
import { etfDownloadRange } from '../etfs/download-range.js';

export type DownloadAssetType = 'etf' | 'index';

export const DEFAULT_INDEX_DOWNLOADS = [
  { tsCode: '000300.SH', name: '沪深300' },
  { tsCode: '000905.SH', name: '中证500' },
  { tsCode: '000852.SH', name: '中证1000' },
  { tsCode: 'H00300.CSI', name: '沪深300全收益' },
  { tsCode: '000985.CSI', name: '中证全指' },
];

const codesSchema = z.array(z.string()).refine((codes) => new Set(codes).size === codes.length);

/**
 * 只保存证券代码，不附加研究角色、代理分类或准入资格。
 *
 * Persist codes without research roles, proxy classes or admission requirements.
 */
export async function readDownloadCodes(assetType: DownloadAssetType): Promise<string[]> {
  const row = await getDatabase().marketDownloadList.findUnique({ where: { assetType } });

  const codes = row ? codesSchema.parse(row.codes) : [];
  if (codes.some((code) => !validDownloadCode(assetType, code))) {
    throw new Error(`Invalid saved ${assetType} download list`);
  }

  return codes;
}

/** 初始化与人工空名单分开；已存在的配置永不被默认值覆盖。
 * Initialize only absent settings; saved empty lists never acquire defaults implicitly. */
export async function initializeIndexDownloads(): Promise<void> {
  const database = getDatabase();
  await withMarketPublication(() =>
    database.$transaction(async (transaction) => {
      await transaction.marketDownloadList.upsert({
        where: { assetType: 'index' },
        create: { assetType: 'index', codes: DEFAULT_INDEX_DOWNLOADS.map((row) => row.tsCode) },
        update: {},
      });
      const codes = await transaction.marketDownloadList.findUniqueOrThrow({
        where: { assetType: 'index' },
      });
      for (const tsCode of codesSchema.parse(codes.codes)) {
        const name = DEFAULT_INDEX_DOWNLOADS.find((row) => row.tsCode === tsCode)?.name ?? tsCode;
        await transaction.indexBenchmark.upsert({
          where: { tsCode },
          create: { tsCode, symbol: tsCode.split('.')[0], name },
          update: {},
        });
      }
    }),
  );
}

export function validDownloadCode(assetType: DownloadAssetType, code: string): boolean {
  return assetType === 'etf'
    ? /^\d{6}\.(SH|SZ)$/.test(code)
    : /^(?:\d{6}|H\d{5})\.(SH|SZ|CSI)$/.test(code);
}

/**
 * 名单修改与同步共用维护锁；移除只影响未来请求，不删除价格历史。
 *
 * Serialize list edits with synchronization; removal stops requests without deleting prices.
 */
export async function changeDownloadList(
  assetType: DownloadAssetType,
  action: 'add' | 'remove',
  code: string,
): Promise<string[]> {
  if (!validDownloadCode(assetType, code)) {
    throw new Error(`Invalid ${assetType} code ${code}`);
  }

  return withMaintenanceLock(async () => {
    const database = getDatabase();
    if (assetType === 'index') {
      await initializeIndexDownloads();
    }
    if (action === 'add' && assetType === 'etf') {
      const row = await database.etfBasic.findUnique({ where: { tsCode: code } });
      if (!row || row.listStatus !== 'L') {
        throw new Error(
          `ETF ${code} is not in the listed catalog; run pnpm data etf select-top first`,
        );
      }
    }
    const current = await readDownloadCodes(assetType);
    const codes =
      action === 'add'
        ? [...new Set([...current, code])].sort()
        : current.filter((value) => value !== code);
    await withMarketPublication(() =>
      database.$transaction(async (transaction) => {
        await transaction.marketDownloadList.upsert({
          where: { assetType },
          create: { assetType, codes },
          update: { codes },
        });
        if (assetType === 'index' && action === 'add') {
          await transaction.indexBenchmark.upsert({
            where: { tsCode: code },
            create: { tsCode: code, symbol: code.split('.')[0], name: code },
            update: {},
          });
        }
      }),
    );

    return codes;
  });
}

/** 返回名单、规模日期和实际价格覆盖，不将元数据目录冒充已下载行情。
 * Return saved codes, size dates and actual prices, never treating metadata as price coverage. */
export async function listDownloads(assetType: DownloadAssetType) {
  const database = getDatabase();
  const setting = await database.marketDownloadList.findUnique({ where: { assetType } });
  const codes = await readDownloadCodes(assetType);
  const sizes = assetType === 'etf' ? await database.etfLatestSize.findMany() : [];
  const etfMetadata =
    assetType === 'etf'
      ? await database.etfBasic.findMany({
          where: { tsCode: { in: codes } },
          select: { tsCode: true, name: true, listStatus: true, listDate: true, delistDate: true },
        })
      : [];
  const metadata =
    assetType === 'etf'
      ? etfMetadata
      : await database.indexBenchmark.findMany({
          where: { tsCode: { in: codes } },
          select: { tsCode: true, name: true },
        });
  const coverage =
    assetType === 'etf'
      ? await database.etfDaily.groupBy({
          by: ['tsCode'],
          where: { tsCode: { in: codes } },
          _min: { tradeDate: true },
          _max: { tradeDate: true },
          _count: { _all: true },
        })
      : await database.indexDaily.groupBy({
          by: ['tsCode'],
          where: { tsCode: { in: codes } },
          _min: { tradeDate: true },
          _max: { tradeDate: true },
          _count: { _all: true },
        });

  const valuations =
    assetType === 'index'
      ? await database.indexDailyBasic.groupBy({
          by: ['tsCode'],
          where: { tsCode: { in: codes } },
          _min: { tradeDate: true },
          _max: { tradeDate: true },
          _count: { _all: true },
        })
      : [];
  const constituents =
    assetType === 'index'
      ? await database.indexWeight.groupBy({
          by: ['indexCode'],
          where: { indexCode: { in: codes } },
          _min: { tradeDate: true },
          _max: { tradeDate: true },
          _count: { _all: true },
        })
      : [];

  return {
    assetType,
    initialized: Boolean(setting),
    updatedAt: setting?.updatedAt ?? null,
    rows: codes.map((tsCode) => ({
      tsCode,
      name: metadata.find((row) => row.tsCode === tsCode)?.name ?? tsCode,
      ...(assetType === 'etf'
        ? {
            lifecycle: etfMetadata.find((row) => row.tsCode === tsCode) ?? null,
            download: etfDownloadRange(
              etfMetadata.find((row) => row.tsCode === tsCode),
              '20150101',
            ),
          }
        : {}),
      ...(assetType === 'index'
        ? {
            valuation: {
              sourceSupported: INDEX_VALUATION_SUPPORTED_CODES.includes(tsCode),
              coverage: valuations.find((row) => row.tsCode === tsCode) ?? null,
            },
            constituents: {
              sourceRequested: tsCode !== 'H00300.CSI',
              coverage: constituents.find((row) => row.indexCode === tsCode) ?? null,
            },
          }
        : {}),
      size: sizes.find((row) => row.tsCode === tsCode) ?? null,
      coverage: coverage.find((row) => row.tsCode === tsCode) ?? null,
    })),
  };
}
