import { writeMarketPartition } from '#market/synchronization/prepare.js';
import type {
  MarketPartition,
  MarketTransaction,
  PreparedMarketPartition,
} from '#market/synchronization/partition.js';

/** 夹具显式进入领域写链，不恢复旧通用生产接口。 / Route fixtures to domain writers without restoring a legacy production API. */
export async function writeFixture(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  dataset: string,
  fetchedAt: Date,
  window?: MarketPartition,
) {
  const first = prepared.tables.flatMap((table) => table.records)[0]?.values;
  const date = String(first?.tradeDate ?? first?.calDate ?? first?.endDate ?? '20260914');
  const scope =
    dataset === 'calendar'
      ? String(first?.exchange ?? 'SSE')
      : dataset.startsWith('index-')
        ? String(first?.tsCode ?? first?.indexCode ?? '000300.SH')
        : dataset.startsWith('etf-') || dataset === 'dividends'
          ? String(first?.tsCode ?? '510300.SH')
          : 'all';

  return writeMarketPartition(
    transaction,
    prepared,
    window ?? { dataset, scope, startDate: date, endDate: date },
    fetchedAt,
  );
}
