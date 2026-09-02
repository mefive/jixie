import type {
  ResearchCommodityHoldingProductCodeV1,
  ResearchCommodityProductCodeV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

export interface ResearchCommodityDatasetRequestV1<TProduct extends string> {
  product: TProduct;
  start: string;
  end: string;
}

/** Load the audited return chain by research availability date. */
export async function loadResearchCommodityReturns(
  request: ResearchCommodityDatasetRequestV1<ResearchCommodityProductCodeV1>,
) {
  const rows = await prisma.commodityContinuousReturn.findMany({
    where: {
      productCode: request.product,
      availableDate: { gte: request.start, lte: request.end },
    },
    select: {
      availableDate: true,
      tradeDate: true,
      productCode: true,
      continuousCode: true,
      mappedContract: true,
      continuousReturn: true,
      continuousLogReturn: true,
      mappedLogReturn: true,
      rollGapLogReturn: true,
      rollYieldProxy: true,
      mappingChanged: true,
    },
    orderBy: { availableDate: 'asc' },
  });
  return rows.map((row) => ({
    date: row.availableDate,
    trade_date: row.tradeDate,
    product: row.productCode,
    continuous_code: row.continuousCode,
    mapped_contract: row.mappedContract,
    continuous_return: row.continuousReturn,
    continuous_log_return: row.continuousLogReturn,
    mapped_log_return: row.mappedLogReturn,
    roll_gap_log_return: row.rollGapLogReturn,
    roll_yield_proxy: row.rollYieldProxy,
    mapping_changed: row.mappingChanged,
  }));
}

/** Load exchange warehouse receipts without collapsing source units. */
export async function loadResearchCommodityWarehouseReceipts(
  request: ResearchCommodityDatasetRequestV1<ResearchCommodityProductCodeV1>,
) {
  const rows = await prisma.commodityWarehouseReceipt.findMany({
    where: {
      productCode: request.product,
      availableDate: { gte: request.start, lte: request.end },
    },
    select: {
      availableDate: true,
      tradeDate: true,
      productCode: true,
      unit: true,
      volume: true,
      volumeChange: true,
      unitCorrectionApplied: true,
    },
    orderBy: [{ availableDate: 'asc' }, { unit: 'asc' }],
  });
  return rows.map((row) => ({
    date: row.availableDate,
    trade_date: row.tradeDate,
    product: row.productCode,
    unit: row.unit,
    volume: row.volume,
    volume_change: row.volumeChange,
    unit_correction_applied: row.unitCorrectionApplied,
  }));
}

/** Load ranked-member aggregates for the deterministic representative contract. */
export async function loadResearchCommodityHoldings(
  request: ResearchCommodityDatasetRequestV1<ResearchCommodityHoldingProductCodeV1>,
) {
  const rows = await prisma.commodityHoldingPosition.findMany({
    where: {
      productCode: request.product,
      availableDate: { gte: request.start, lte: request.end },
    },
    select: {
      availableDate: true,
      tradeDate: true,
      productCode: true,
      referenceContract: true,
      contractOpenInterest: true,
      contractVolume: true,
      rankedVolume: true,
      rankedVolumeChange: true,
      rankedLongHolding: true,
      rankedLongChange: true,
      rankedShortHolding: true,
      rankedShortChange: true,
      topFiveLongHolding: true,
      topFiveShortHolding: true,
      volumeMemberCount: true,
      longMemberCount: true,
      shortMemberCount: true,
      sourceCorrectionApplied: true,
    },
    orderBy: { availableDate: 'asc' },
  });
  return rows.map((row) => ({
    date: row.availableDate,
    trade_date: row.tradeDate,
    product: row.productCode,
    reference_contract: row.referenceContract,
    contract_open_interest: row.contractOpenInterest,
    contract_volume: row.contractVolume,
    ranked_volume: row.rankedVolume,
    ranked_volume_change: row.rankedVolumeChange,
    ranked_long_holding: row.rankedLongHolding,
    ranked_long_change: row.rankedLongChange,
    ranked_short_holding: row.rankedShortHolding,
    ranked_short_change: row.rankedShortChange,
    top_five_long_holding: row.topFiveLongHolding,
    top_five_short_holding: row.topFiveShortHolding,
    volume_member_count: row.volumeMemberCount,
    long_member_count: row.longMemberCount,
    short_member_count: row.shortMemberCount,
    source_correction_applied: row.sourceCorrectionApplied,
  }));
}
