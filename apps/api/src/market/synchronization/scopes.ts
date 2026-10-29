import { getDatabase } from '#infra/database/prisma.js';
import type { DatasetPolicy } from './partition.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { readDownloadCodes } from '../downloads/lists.js';
import { INDEX_VALUATION_SUPPORTED_CODES } from '../registry/index-presets.js';
import { etfDownloadRange } from '../etfs/download-range.js';

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
      return scopes(policy, ['SSE', 'SZSE']);
    case 'stock-master':
      return scopes(policy, ['L', 'D', 'P', 'G']);
    case 'stock-names':
      return scopes(policy, ['all']);
    case 'etf-master':
      return scopes(policy, ['all']);
    case 'index-prices':
      return scopes(policy, await readDownloadCodes('index'));
    case 'index-valuations':
      return scopes(
        policy,
        (await readDownloadCodes('index')).filter((code) =>
          INDEX_VALUATION_SUPPORTED_CODES.includes(code),
        ),
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
