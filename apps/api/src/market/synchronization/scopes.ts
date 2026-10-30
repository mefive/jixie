import { calendarDay } from './date.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { DatasetPolicy } from './partition.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { readDownloadCodes } from '../downloads/lists.js';
import { INDEX_VALUATION_SUPPORTED_CODES } from '../registry/index-presets.js';
import { etfDownloadRange } from '../etfs/download-range.js';

/**
 * 已核对来源首日；未知代码保持缺口，不以本地首行猜测。
 *
 * Verified source first dates; local first rows never imply full history.
 */
const INDEX_PRICE_STARTS: Record<string, string> = {
  '000300.SH': '20020104',
  '000905.SH': '20041231',
  '000852.SH': '20041231',
  '000985.CSI': '20041231',
  'H00300.CSI': '20041231',
};
const INDEX_VALUATION_STARTS: Record<string, string> = {
  '000300.SH': '20050408',
  '000905.SH': '20070115',
};

export interface DatasetScope {
  scope: string;
  startDate: string;
  endDate?: string;
  calendar?: string;
  timeZone?: string;
  closeHour?: number;
  blockedReason?: string;
}

function scopes(policy: DatasetPolicy, names: readonly string[]): DatasetScope[] {
  return [...new Set(names)].map((scope) => ({ scope, startDate: policy.startDate }));
}

/**
 * ETF／指数对象只读管理员保存名单；其他对象来自来源目录。
 *
 * ETF/index objects follow saved administrator lists; other objects follow source catalogs.
 */
export async function datasetScopes(policy: DatasetPolicy): Promise<DatasetScope[]> {
  switch (policy.dataset) {
    case 'calendar':
      return [
        { scope: 'SSE', startDate: '19901219' },
        { scope: 'SZSE', startDate: '19910703' },
      ];
    case 'stock-master':
      return scopes(policy, ['L', 'D', 'P', 'G']);
    case 'stock-names':
      return scopes(policy, ['all']);
    case 'etf-master':
      return scopes(policy, ['all']);
    case 'index-prices':
      return applySourceBoundaries(
        policy,
        scopes(policy, await readDownloadCodes('index')).map((entry) => ({
          ...entry,
          startDate: INDEX_PRICE_STARTS[entry.scope] ?? entry.startDate,
        })),
      );
    case 'index-valuations':
      return applySourceBoundaries(
        policy,
        scopes(
          policy,
          (await readDownloadCodes('index')).filter((code) =>
            INDEX_VALUATION_SUPPORTED_CODES.includes(code),
          ),
        ).map((entry) => ({
          ...entry,
          startDate: INDEX_VALUATION_STARTS[entry.scope] ?? entry.startDate,
        })),
      );
    case 'index-weights':
      return scopes(
        policy,
        (await readDownloadCodes('index')).filter((code) => code !== 'H00300.CSI'),
      );
    case 'etf-prices':
    case 'etf-adjustments': {
      const codes = await readDownloadCodes('etf');
      const rows = await getDatabase().etfBasic.findMany({ where: { tsCode: { in: codes } } });

      return codes.map((code) => {
        const row = rows.find((item) => item.tsCode === code);

        return {
          scope: code,
          ...etfDownloadRange(row, policy.startDate),
        };
      });
    }
    case 'financial-statements':
      return scopes(
        policy,
        ['income', 'balance_sheet', 'cash_flow'].flatMap((kind) =>
          ['1', '4', '5'].map((reportType) => `${kind}|${reportType}`),
        ),
      );
    case 'financial-indicators':
      return scopes(policy, ['all']);
    case 'dividends': {
      const rows = await getDatabase().stockBasic.findMany({
        select: { tsCode: true, listDate: true },
      });
      const starts = new Map<string, string>();
      for (const row of rows) {
        const code = canonicalStockCode(row.tsCode);
        starts.set(code, [policy.startDate, row.listDate ?? policy.startDate].sort().at(-1)!);
      }
      return [...starts].map(([scope, startDate]) => ({ scope, startDate }));
    }
    default:
      return scopes(policy, ['all']);
  }
}

/**
 * 两类指数序列复用已探明的来源边界。
 *
 * Both index series reuse explicitly discovered source bounds.
 */
async function applySourceBoundaries(
  policy: DatasetPolicy,
  objects: DatasetScope[],
): Promise<DatasetScope[]> {
  const boundaries = await getDatabase().datasetSyncPartition.findMany({
    where: { dataset: policy.dataset, policyVersion: policy.version, status: 'unavailable' },
  });

  return objects.map((object) => {
    const first = boundaries
      .filter((entry) => entry.scope === object.scope && entry.startDate === policy.startDate)
      .map((entry) => calendarDay(entry.endDate, 1))
      .sort()
      .at(-1);
    return { ...object, startDate: first && first > object.startDate ? first : object.startDate };
  });
}
