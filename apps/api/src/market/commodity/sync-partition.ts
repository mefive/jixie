import { datasetInputReadiness } from '../synchronization/readiness.js';
import { getDatabase } from '#infra/database/prisma.js';
import type {
  MarketPartition,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import type { SyncSource } from '../synchronization/source.js';
import { COMMODITY_FUTURE_SPECS } from './commodity-futures.js';
import {
  buildCommodityWarehouseReceiptDaily,
  fetchCommodityWarehouseReceiptRange,
} from './commodity-warehouse-receipts.js';
import {
  buildCommodityHoldingFetchRanges,
  buildCommodityHoldingPositions,
  fetchCommodityHoldingRange,
  loadCommodityHoldingRepresentatives,
} from './commodity-holding-positions.js';

/**
 * 复用已审计单位和代表合约规则，完整日对象才作为聚合写入。
 *
 * Reuse audited units and representative-contract rules; admit only complete daily objects.
 */
export async function prepareCommodityPartition(
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const calendar = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: partition.startDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const openDates = calendar.map((entry) => entry.calDate);
  const records: SourceRecord[] = [];
  const errors: string[] = [];
  const gaps: string[] = [];
  if (partition.dataset === 'commodity-receipts') {
    const spec = COMMODITY_FUTURE_SPECS.find((entry) => entry.productCode === partition.scope);
    if (!spec) {
      throw new Error('Unknown warehouse-receipt product');
    }
    const rows = await fetchCommodityWarehouseReceiptRange(
      source,
      spec.productCode,
      partition.startDate,
      partition.endDate,
    );
    const points = buildCommodityWarehouseReceiptDaily(
      rows,
      {
        productCode: spec.productCode,
        sourceName: spec.warehouseReceipt.sourceName,
        units: spec.warehouseReceipt.units,
      },
      openDates,
      partition.startDate,
      partition.endDate,
    );
    records.push(
      ...points.map((point) => ({
        values: { ...point, retrievedAt: fetchedAt },
        availableDate: point.availableDate,
        availabilityQuality: 'source_contract' as const,
      })),
    );
  } else {
    const candidates = (
      await loadCommodityHoldingRepresentatives(
        partition.startDate,
        partition.endDate,
        getDatabase(),
      )
    ).filter((entry) => entry.productCode === partition.scope);
    const representatives = [] as typeof candidates;
    for (const candidate of candidates) {
      const spec = COMMODITY_FUTURE_SPECS.find(
        (entry) => entry.productCode === candidate.productCode,
      )!;
      const metadata = await getDatabase().datasetSyncPartition.findFirst({
        where: {
          dataset: 'commodity-contracts',
          scope: `${spec.exchange}|${spec.productCode}`,
          status: 'complete',
          endDate: { gte: candidate.tradeDate },
        },
      });
      const contracts = await getDatabase().futureContract.findMany({
        where: {
          productCode: candidate.productCode,
          listDate: { lte: candidate.tradeDate },
          delistDate: { gte: candidate.tradeDate },
        },
        select: { tsCode: true },
      });
      const proof = await datasetInputReadiness(
        contracts.map((contract) => ({
          dataset: 'commodity-prices',
          scope: contract.tsCode,
          startDate: candidate.tradeDate,
          endDate: candidate.tradeDate,
        })),
      );
      const bars = await getDatabase().futureDaily.findMany({
        where: {
          tsCode: { in: contracts.map((contract) => contract.tsCode) },
          tradeDate: candidate.tradeDate,
        },
        select: { tsCode: true, openInterest: true, volume: true },
      });
      if (
        !metadata ||
        !proof.ready ||
        contracts.some(
          (contract) =>
            !bars.some(
              (bar) =>
                bar.tsCode === contract.tsCode && bar.openInterest != null && bar.volume != null,
            ),
        )
      ) {
        gaps.push(
          `${candidate.productCode}/${candidate.tradeDate}: representative-contract sample is incomplete`,
        );
        continue;
      }
      representatives.push(candidate);
    }
    for (const range of buildCommodityHoldingFetchRanges(representatives)) {
      try {
        const rows = await fetchCommodityHoldingRange(source, range);
        const points = buildCommodityHoldingPositions(rows, range.representatives, openDates);
        records.push(
          ...points.map((point) => ({
            values: { ...point, retrievedAt: fetchedAt },
            availableDate: point.availableDate,
            availabilityQuality: 'source_contract' as const,
          })),
        );
        if (points.length !== range.representatives.length) {
          errors.push(`${range.referenceContract}: incomplete ranking dates`);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (!representatives.length) {
      gaps.push(`${partition.scope}: no eligible representative-contract inputs`);
    }
  }
  if (!records.length && !errors.length && !gaps.length) {
    errors.push(`${partition.dataset}: unexplained empty response`);
  }

  return {
    tables: [
      {
        table:
          partition.dataset === 'commodity-receipts'
            ? 'CommodityWarehouseReceipt'
            : 'CommodityHoldingPosition',
        records,
      },
    ],
    status: errors.length ? 'error' : gaps.length ? 'waiting' : 'complete',
    evidence: { boundedCompleteObjects: !errors.length },
    gaps,
    errors,
    observedDates: records.map((record) => String(record.values.tradeDate)),
  };
}
