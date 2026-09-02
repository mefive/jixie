import { z } from 'zod';
import {
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_COMMODITY_HOLDINGS_SDK_CONTRACT_V1,
  RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1,
  RESEARCH_COMMODITY_WAREHOUSE_RECEIPTS_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_FLOWS_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1,
  RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FACTOR_WEATHER_SDK_CONTRACT_V1,
  RESEARCH_ETF_SHARES_SDK_CONTRACT_V1,
  RESEARCH_FX_SDK_CONTRACT_V1,
  RESEARCH_FUTURES_SETTLEMENT_SDK_CONTRACT_V1,
  RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1,
  RESEARCH_INDUSTRY_STATE_SDK_CONTRACT_V1,
  RESEARCH_MACRO_SDK_CONTRACT_V1,
  RESEARCH_MARKET_STATE_SDK_CONTRACT_V1,
  RESEARCH_PANEL_SDK_CONTRACT_V1,
  RESEARCH_SERIES_SDK_CONTRACT_V1,
  RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1,
  RESEARCH_YIELD_CURVE_SDK_CONTRACT_V1,
  type ResearchAssetTypeV1,
  type ResearchCommodityHoldingProductCodeV1,
  type ResearchCommodityProductCodeV1,
  type ResearchFrequencyV1,
  type ResearchFxSeriesIdV1,
  type ResearchMacroSeriesKeyV1,
  type ResearchMarketStateScopeV1,
  type ResearchSdkDataFrameColumnContractV1,
  type ResearchSdkParameterContractV1,
  type ResearchTransformV1,
  type ResearchYieldCurveCodeV1,
  type ResearchYieldTenorV1,
  type ResearchYieldTransformV1,
} from '@jixie/shared';

export interface ResearchSeriesRuntimeRequestV1 {
  asset_type: ResearchAssetTypeV1;
  identifier: string;
  start: string;
  end: string;
  measure: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchTransformV1;
  partial_period: 'exclude' | 'include';
}

export interface ResearchSeriesRuntimeRowV1 {
  date: string;
  value: number;
}

export interface ResearchYieldCurveRuntimeRequestV1 {
  curve: ResearchYieldCurveCodeV1;
  tenor: ResearchYieldTenorV1;
  start: string;
  end: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchYieldTransformV1;
  partial_period: 'exclude' | 'include';
}

export interface ResearchMacroRuntimeRequestV1 {
  series: ResearchMacroSeriesKeyV1;
  start: string;
  end: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchTransformV1;
  partial_period: 'exclude' | 'include';
}

export interface ResearchFxRuntimeRequestV1 {
  pair: ResearchFxSeriesIdV1;
  start: string;
  end: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchTransformV1;
  partial_period: 'exclude' | 'include';
}

export interface ResearchCommodityRuntimeRequestV1 {
  product: ResearchCommodityProductCodeV1;
  start: string;
  end: string;
}

export interface ResearchCommodityHoldingRuntimeRequestV1 {
  product: ResearchCommodityHoldingProductCodeV1;
  start: string;
  end: string;
}

export interface ResearchMarketStateRuntimeRequestV1 {
  scope: ResearchMarketStateScopeV1;
  start: string;
  end: string;
}

export interface ResearchDatedIdentifierRuntimeRequestV1 {
  identifier: string;
  start: string;
  end: string;
}

export interface ResearchCrossSectionRuntimeRequestV1 {
  universe: string;
  date: string;
  minimum_listed_days: number;
  risk_warning: 'exclude' | 'include';
}

export interface ResearchPanelRuntimeRequestV1 {
  universe: string;
  start: string;
  end: string;
  frequency: 'month_end';
  minimum_listed_days: number;
  risk_warning: 'exclude' | 'include';
}

export interface ResearchFactorReportRuntimeRequestV1 {
  report_id: string;
}

export interface ResearchBacktestReportRuntimeRequestV1 {
  report_id: string;
}

export interface ResearchStrategyScanReportRuntimeRequestV1 {
  report_id: string;
}

export interface ResearchFactorWeatherRuntimeRequestV1 {
  factor_id: string;
}

const researchSeriesRequestSchema = z.strictObject(
  Object.fromEntries(
    RESEARCH_SERIES_SDK_CONTRACT_V1.parameters.map((parameter) => [
      parameter.name,
      sdkParameterSchema(parameter),
    ]),
  ),
);

const researchSeriesRowsSchema = z.array(
  z.strictObject(
    Object.fromEntries(
      RESEARCH_SERIES_SDK_CONTRACT_V1.returns.kind === 'dataframe'
        ? RESEARCH_SERIES_SDK_CONTRACT_V1.returns.columns.map((column) => [
            column.name,
            sdkWireColumnSchema(column),
          ])
        : [],
    ),
  ),
);

const researchCrossSectionRequestSchema = sdkRequestSchema(
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.parameters,
);
const researchPanelRequestSchema = sdkRequestSchema(RESEARCH_PANEL_SDK_CONTRACT_V1.parameters);
const researchYieldCurveRequestSchema = sdkRequestSchema(
  RESEARCH_YIELD_CURVE_SDK_CONTRACT_V1.parameters,
);
const researchMacroRequestSchema = sdkRequestSchema(RESEARCH_MACRO_SDK_CONTRACT_V1.parameters);
const researchFxRequestSchema = sdkRequestSchema(RESEARCH_FX_SDK_CONTRACT_V1.parameters);
const researchFactorReportRequestSchema = sdkRequestSchema(
  RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1.parameters,
);
const researchBacktestReportRequestSchema = sdkRequestSchema(
  RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1.parameters,
);
const researchStrategyScanReportRequestSchema = sdkRequestSchema(
  RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1.parameters,
);
const researchFactorWeatherRequestSchema = sdkRequestSchema(
  RESEARCH_FACTOR_WEATHER_SDK_CONTRACT_V1.parameters,
);
const researchFactorWeatherRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_FACTOR_WEATHER_SDK_CONTRACT_V1.returns,
);
const researchCommodityReturnsRequestSchema = sdkRequestSchema(
  RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1.parameters,
);
const researchCommodityWarehouseReceiptsRequestSchema = sdkRequestSchema(
  RESEARCH_COMMODITY_WAREHOUSE_RECEIPTS_SDK_CONTRACT_V1.parameters,
);
const researchCommodityHoldingsRequestSchema = sdkRequestSchema(
  RESEARCH_COMMODITY_HOLDINGS_SDK_CONTRACT_V1.parameters,
);
const researchCommodityReturnsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1.returns,
);
const researchCommodityWarehouseReceiptsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_COMMODITY_WAREHOUSE_RECEIPTS_SDK_CONTRACT_V1.returns,
);
const researchCommodityHoldingsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_COMMODITY_HOLDINGS_SDK_CONTRACT_V1.returns,
);
const researchMarketStateRequestSchema = sdkRequestSchema(
  RESEARCH_MARKET_STATE_SDK_CONTRACT_V1.parameters,
);
const researchEquityFundamentalsRequestSchema = sdkRequestSchema(
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1.parameters,
);
const researchEquityFlowsRequestSchema = sdkRequestSchema(
  RESEARCH_EQUITY_FLOWS_SDK_CONTRACT_V1.parameters,
);
const researchEquityDividendsRequestSchema = sdkRequestSchema(
  RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1.parameters,
);
const researchEtfSharesRequestSchema = sdkRequestSchema(
  RESEARCH_ETF_SHARES_SDK_CONTRACT_V1.parameters,
);
const researchIndexValuationRequestSchema = sdkRequestSchema(
  RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1.parameters,
);
const researchIndustryStateRequestSchema = sdkRequestSchema(
  RESEARCH_INDUSTRY_STATE_SDK_CONTRACT_V1.parameters,
);
const researchFuturesSettlementRequestSchema = sdkRequestSchema(
  RESEARCH_FUTURES_SETTLEMENT_SDK_CONTRACT_V1.parameters,
);
const researchMarketStateRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_MARKET_STATE_SDK_CONTRACT_V1.returns,
);
const researchEquityFundamentalsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1.returns,
);
const researchEquityFlowsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_EQUITY_FLOWS_SDK_CONTRACT_V1.returns,
);
const researchEquityDividendsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1.returns,
);
const researchEtfSharesRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_ETF_SHARES_SDK_CONTRACT_V1.returns,
);
const researchIndexValuationRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1.returns,
);
const researchIndustryStateRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_INDUSTRY_STATE_SDK_CONTRACT_V1.returns,
);
const researchFuturesSettlementRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_FUTURES_SETTLEMENT_SDK_CONTRACT_V1.returns,
);
const researchEquityDatasetRowsSchema = z.array(
  z.strictObject(
    Object.fromEntries(
      RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.returns.kind === 'dataframe'
        ? RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1.returns.columns.map((column) => [
            column.name,
            sdkWireColumnSchema(column),
          ])
        : [],
    ),
  ),
);

export function parseResearchSeriesRuntimeRequest(value: unknown): ResearchSeriesRuntimeRequestV1 {
  return researchSeriesRequestSchema.parse(value) as unknown as ResearchSeriesRuntimeRequestV1;
}

export function parseResearchSeriesRuntimeRows(value: unknown): ResearchSeriesRuntimeRowV1[] {
  return researchSeriesRowsSchema.parse(value) as unknown as ResearchSeriesRuntimeRowV1[];
}

export function parseResearchCrossSectionRuntimeRequest(
  value: unknown,
): ResearchCrossSectionRuntimeRequestV1 {
  return researchCrossSectionRequestSchema.parse(
    value,
  ) as unknown as ResearchCrossSectionRuntimeRequestV1;
}

export function parseResearchPanelRuntimeRequest(value: unknown): ResearchPanelRuntimeRequestV1 {
  return researchPanelRequestSchema.parse(value) as unknown as ResearchPanelRuntimeRequestV1;
}

export function parseResearchYieldCurveRuntimeRequest(
  value: unknown,
): ResearchYieldCurveRuntimeRequestV1 {
  return researchYieldCurveRequestSchema.parse(
    value,
  ) as unknown as ResearchYieldCurveRuntimeRequestV1;
}

export function parseResearchMacroRuntimeRequest(value: unknown): ResearchMacroRuntimeRequestV1 {
  return researchMacroRequestSchema.parse(value) as unknown as ResearchMacroRuntimeRequestV1;
}

export function parseResearchFxRuntimeRequest(value: unknown): ResearchFxRuntimeRequestV1 {
  return researchFxRequestSchema.parse(value) as unknown as ResearchFxRuntimeRequestV1;
}

export function parseResearchFactorReportRuntimeRequest(
  value: unknown,
): ResearchFactorReportRuntimeRequestV1 {
  return researchFactorReportRequestSchema.parse(
    value,
  ) as unknown as ResearchFactorReportRuntimeRequestV1;
}

export function parseResearchBacktestReportRuntimeRequest(
  value: unknown,
): ResearchBacktestReportRuntimeRequestV1 {
  return researchBacktestReportRequestSchema.parse(
    value,
  ) as unknown as ResearchBacktestReportRuntimeRequestV1;
}

export function parseResearchStrategyScanReportRuntimeRequest(
  value: unknown,
): ResearchStrategyScanReportRuntimeRequestV1 {
  return researchStrategyScanReportRequestSchema.parse(
    value,
  ) as unknown as ResearchStrategyScanReportRuntimeRequestV1;
}

export function parseResearchFactorWeatherRuntimeRequest(
  value: unknown,
): ResearchFactorWeatherRuntimeRequestV1 {
  return researchFactorWeatherRequestSchema.parse(
    value,
  ) as unknown as ResearchFactorWeatherRuntimeRequestV1;
}

export function parseResearchFactorWeatherRuntimeRows(value: unknown): unknown[] {
  return researchFactorWeatherRowsSchema.parse(value);
}

export function parseResearchCommodityReturnsRuntimeRequest(
  value: unknown,
): ResearchCommodityRuntimeRequestV1 {
  return researchCommodityReturnsRequestSchema.parse(
    value,
  ) as unknown as ResearchCommodityRuntimeRequestV1;
}

export function parseResearchCommodityWarehouseReceiptsRuntimeRequest(
  value: unknown,
): ResearchCommodityRuntimeRequestV1 {
  return researchCommodityWarehouseReceiptsRequestSchema.parse(
    value,
  ) as unknown as ResearchCommodityRuntimeRequestV1;
}

export function parseResearchCommodityHoldingsRuntimeRequest(
  value: unknown,
): ResearchCommodityHoldingRuntimeRequestV1 {
  return researchCommodityHoldingsRequestSchema.parse(
    value,
  ) as unknown as ResearchCommodityHoldingRuntimeRequestV1;
}

export function parseResearchCommodityReturnsRuntimeRows(value: unknown): unknown[] {
  return researchCommodityReturnsRowsSchema.parse(value);
}

export function parseResearchCommodityWarehouseReceiptsRuntimeRows(value: unknown): unknown[] {
  return researchCommodityWarehouseReceiptsRowsSchema.parse(value);
}

export function parseResearchCommodityHoldingsRuntimeRows(value: unknown): unknown[] {
  return researchCommodityHoldingsRowsSchema.parse(value);
}

export function parseResearchMarketStateRuntimeRequest(
  value: unknown,
): ResearchMarketStateRuntimeRequestV1 {
  return researchMarketStateRequestSchema.parse(
    value,
  ) as unknown as ResearchMarketStateRuntimeRequestV1;
}

export function parseResearchEquityFundamentalsRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchEquityFundamentalsRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchEquityFlowsRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchEquityFlowsRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchEquityDividendsRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchEquityDividendsRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchEtfSharesRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchEtfSharesRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchIndexValuationRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchIndexValuationRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchIndustryStateRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchIndustryStateRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchFuturesSettlementRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchFuturesSettlementRequestSchema.parse(
    value,
  ) as unknown as ResearchDatedIdentifierRuntimeRequestV1;
}

export function parseResearchMarketStateRuntimeRows(value: unknown): unknown[] {
  return researchMarketStateRowsSchema.parse(value);
}

export function parseResearchEquityFundamentalsRuntimeRows(value: unknown): unknown[] {
  return researchEquityFundamentalsRowsSchema.parse(value);
}

export function parseResearchEquityFlowsRuntimeRows(value: unknown): unknown[] {
  return researchEquityFlowsRowsSchema.parse(value);
}

export function parseResearchEquityDividendsRuntimeRows(value: unknown): unknown[] {
  return researchEquityDividendsRowsSchema.parse(value);
}

export function parseResearchEtfSharesRuntimeRows(value: unknown): unknown[] {
  return researchEtfSharesRowsSchema.parse(value);
}

export function parseResearchIndexValuationRuntimeRows(value: unknown): unknown[] {
  return researchIndexValuationRowsSchema.parse(value);
}

export function parseResearchIndustryStateRuntimeRows(value: unknown): unknown[] {
  return researchIndustryStateRowsSchema.parse(value);
}

export function parseResearchFuturesSettlementRuntimeRows(value: unknown): unknown[] {
  return researchFuturesSettlementRowsSchema.parse(value);
}

export function parseResearchEquityDatasetRuntimeRows(value: unknown): unknown[] {
  return researchEquityDatasetRowsSchema.parse(value);
}

function sdkRequestSchema(parameters: readonly ResearchSdkParameterContractV1[]): z.ZodType {
  return z.strictObject(
    Object.fromEntries(
      parameters.map((parameter) => [parameter.name, sdkParameterSchema(parameter)]),
    ),
  );
}

function sdkDataFrameRowsSchema(
  returns: (typeof RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1)['returns'],
): z.ZodType<unknown[]> {
  if (returns.kind !== 'dataframe') {
    throw new Error('Research SDK dataset contract must return a DataFrame');
  }
  return z.array(
    z.strictObject(
      Object.fromEntries(
        returns.columns.map((column) => [column.name, sdkWireColumnSchema(column)]),
      ),
    ),
  );
}

function sdkParameterSchema(parameter: ResearchSdkParameterContractV1): z.ZodType {
  switch (parameter.type) {
    case 'date':
      return z.string().regex(/^\d{8}$/);
    case 'enum':
      if (!parameter.values?.length) {
        throw new Error(`SDK enum parameter ${parameter.name} has no values`);
      }
      return z.enum(parameter.values as [string, ...string[]]);
    case 'integer':
      return z.number().int();
    case 'string': {
      const schema = z.string().trim().min(1);
      return parameter.maximumLength ? schema.max(parameter.maximumLength) : schema;
    }
    case 'dataframe':
    case 'string_map':
    case 'string_or_string_list':
      throw new Error(`SDK parameter ${parameter.name} cannot cross the research data bridge`);
  }
}

function sdkWireColumnSchema(column: ResearchSdkDataFrameColumnContractV1): z.ZodType {
  switch (column.wireType) {
    case 'trade_date':
      return z.string().regex(/^\d{8}$/);
    case 'number':
      return z.number().finite();
    case 'nullable_number':
      return z.number().finite().nullable();
    case 'string':
      return z.string();
    case 'nullable_string':
      return z.string().nullable();
    case 'boolean':
      return z.boolean();
  }
}
