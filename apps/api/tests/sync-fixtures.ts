import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { selectSyncWindow } from '#maintenance/partitions.js';
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

/** 仅汇总一次直接选择结果供夹具断言。 / Collect one selection pass for fixture assertions. */
export async function selectFixtureWindows(input: {
  targetDate: string;
  startedAt: Date;
  budget?: number;
  excludeIds?: ReadonlySet<string>;
}) {
  const attempted = new Set(input.excludeIds);
  const partitions = [];
  for (const policy of DATASET_POLICIES) {
    for (const history of [false, true]) {
      const selected = await selectSyncWindow({
        policy,
        targetDate: input.targetDate,
        startedAt: input.startedAt,
        history,
        attempted,
        deadline: Date.now() + 30_000,
      });
      if (selected) {
        partitions.push(selected);
        attempted.add(selected.id);
      }
    }
  }

  return { partitions, gaps: [] as string[] };
}
