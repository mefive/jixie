import type { ResearchFinancialValuesRequestV1 } from '../../datasets/financial-values.js';
import { z } from 'zod';
import type { RESEARCH_SDK_CONTRACT_V1 } from '@jixie/shared';
import {
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1,
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_PANEL_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1,
  RESEARCH_FINANCIAL_VALUES_SDK_CONTRACT_V1,
  RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1,
  RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1,
  RESEARCH_ETF_SHARES_SDK_CONTRACT_V1,
  RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1,
  RESEARCH_PANEL_SDK_CONTRACT_V1,
  RESEARCH_SERIES_SDK_CONTRACT_V1,
  RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1,
  type ResearchAssetTypeV1,
  type ResearchFrequencyV1,
  type ResearchFinancialMetricV1,
  type ResearchSdkDataFrameColumnContractV1,
  type ResearchSdkParameterContractV1,
  type ResearchTransformV1,
} from '@jixie/shared';

/**
 * 在宿主边界描述公开序列的频率、变换和未完成周期政策。
 *
 * Describe series frequency, transform and partial-period policy at the host boundary.
 */
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

/**
 * 约束公开序列返回列，供宿主与 Python 通信校验。
 *
 * Constrain public series result columns across host and Python.
 */
export interface ResearchSeriesRuntimeRowV1 {
  date: string;
  value: number;
}

/**
 * 定义带日期对象查询的 snake_case 传输参数。
 *
 * Describe snake_case arguments for dated identifier reads.
 */
export interface ResearchDatedIdentifierRuntimeRequestV1 {
  identifier: string;
  start: string;
  end: string;
}

/**
 * 描述股票时点截面的证券池与可投资性筛选。
 *
 * Describe universe and investability filters for a dated equity cross-section.
 */
export interface ResearchCrossSectionRuntimeRequestV1 {
  universe: string;
  date: string;
  minimum_listed_days: number;
  risk_warning: 'exclude' | 'include';
}

/**
 * 描述已完成月末 Panel 的证券池与日期。
 *
 * Describe universe and dates for a completed-month-end panel.
 */
export interface ResearchPanelRuntimeRequestV1 {
  universe: string;
  start: string;
  end: string;
  frequency: 'month_end';
  minimum_listed_days: number;
  risk_warning: 'exclude' | 'include';
}

/**
 * 限定单证券财报的时点、字段与报告期边界。
 *
 * Bound a single-instrument financial query by as-of date, fields and reports.
 */
export interface ResearchSingleFinancialRuntimeRequestV1 {
  identifier: string;
  as_of: string;
  fields?: string | string[];
  report_start?: string;
  report_end?: string;
}

/**
 * 在股票截面参数上增加显式财务指标选择。
 *
 * Extend cross-section arguments with selected financial metrics.
 */
export interface ResearchFinancialCrossSectionRuntimeRequestV1 extends ResearchCrossSectionRuntimeRequestV1 {
  metrics: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[];
}

/**
 * 在股票 Panel 参数上增加显式财务指标选择。
 *
 * Extend panel arguments with selected financial metrics.
 */
export interface ResearchFinancialPanelRuntimeRequestV1 extends ResearchPanelRuntimeRequestV1 {
  metrics: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[];
}

/**
 * 传递因子报告身份，访问与揭示校验仍由业务加载器负责。
 *
 * Identify a factor report; the loader retains access and reveal checks.
 */
export interface ResearchFactorReportRuntimeRequestV1 {
  report_id: string;
}

/**
 * 传递回测报告身份，归属校验仍由业务加载器负责。
 *
 * Identify a backtest report; the loader retains ownership checks.
 */
export interface ResearchBacktestReportRuntimeRequestV1 {
  report_id: string;
}

/**
 * 传递不可变扫描报告身份，供授权结果读取。
 *
 * Identify an immutable scan report for authorized loading.
 */
export interface ResearchStrategyScanReportRuntimeRequestV1 {
  report_id: string;
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
const researchFactorReportRequestSchema = sdkRequestSchema(
  RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1.parameters,
);
const researchBacktestReportRequestSchema = sdkRequestSchema(
  RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1.parameters,
);
const researchStrategyScanReportRequestSchema = sdkRequestSchema(
  RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1.parameters,
);
const researchEquityFundamentalsRequestSchema = sdkRequestSchema(
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1.parameters,
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
const researchFinancialValuesRequestSchema = sdkRequestSchema(
  RESEARCH_FINANCIAL_VALUES_SDK_CONTRACT_V1.parameters,
);
const researchFinancialValuesRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_FINANCIAL_VALUES_SDK_CONTRACT_V1.returns,
);
export function parseResearchFinancialValuesRuntimeRequest(
  value: unknown,
): ResearchFinancialValuesRequestV1 {
  return researchFinancialValuesRequestSchema.parse(value) as ResearchFinancialValuesRequestV1;
}
export function parseResearchFinancialValuesRuntimeRows(value: unknown): unknown[] {
  return researchFinancialValuesRowsSchema.parse(value);
}
const researchFinancialStatementsRequestSchema = sdkRequestSchema(
  RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1.parameters,
);
const researchFinancialMetricsRequestSchema = sdkRequestSchema(
  RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1.parameters,
);
const researchFinancialCrossSectionRequestSchema = sdkRequestSchema(
  RESEARCH_FINANCIAL_CROSS_SECTION_SDK_CONTRACT_V1.parameters,
);
const researchFinancialPanelRequestSchema = sdkRequestSchema(
  RESEARCH_FINANCIAL_PANEL_SDK_CONTRACT_V1.parameters,
);
const researchEquityFundamentalsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1.returns,
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
const researchFinancialStatementsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1.returns,
);
const researchFinancialMetricsRowsSchema = sdkDataFrameRowsSchema(
  RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1.returns,
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

export function parseResearchFinancialStatementsRuntimeRequest(
  value: unknown,
): ResearchSingleFinancialRuntimeRequestV1 {
  return researchFinancialStatementsRequestSchema.parse(
    value,
  ) as unknown as ResearchSingleFinancialRuntimeRequestV1;
}

export function parseResearchFinancialMetricsRuntimeRequest(
  value: unknown,
): ResearchSingleFinancialRuntimeRequestV1 {
  return researchFinancialMetricsRequestSchema.parse(
    value,
  ) as unknown as ResearchSingleFinancialRuntimeRequestV1;
}

export function parseResearchFinancialCrossSectionRuntimeRequest(
  value: unknown,
): ResearchFinancialCrossSectionRuntimeRequestV1 {
  return researchFinancialCrossSectionRequestSchema.parse(
    value,
  ) as unknown as ResearchFinancialCrossSectionRuntimeRequestV1;
}

export function parseResearchFinancialPanelRuntimeRequest(
  value: unknown,
): ResearchFinancialPanelRuntimeRequestV1 {
  return researchFinancialPanelRequestSchema.parse(
    value,
  ) as unknown as ResearchFinancialPanelRuntimeRequestV1;
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

export function parseResearchEquityFundamentalsRuntimeRequest(
  value: unknown,
): ResearchDatedIdentifierRuntimeRequestV1 {
  return researchEquityFundamentalsRequestSchema.parse(
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

export function parseResearchEquityFundamentalsRuntimeRows(value: unknown): unknown[] {
  return researchEquityFundamentalsRowsSchema.parse(value);
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

export function parseResearchFinancialStatementsRuntimeRows(value: unknown): unknown[] {
  return researchFinancialStatementsRowsSchema.parse(value);
}

export function parseResearchFinancialMetricsRuntimeRows(value: unknown): unknown[] {
  return researchFinancialMetricsRowsSchema.parse(value);
}

export function parseResearchEquityDatasetRuntimeRows(value: unknown): unknown[] {
  return researchEquityDatasetRowsSchema.parse(value);
}

function sdkRequestSchema(parameters: readonly ResearchSdkParameterContractV1[]): z.ZodType {
  return z.strictObject(
    Object.fromEntries(
      parameters.map((parameter) => {
        const schema = sdkParameterSchema(parameter);
        return [
          parameter.name,
          parameter.required
            ? schema
            : parameter.defaultValue == null
              ? schema.optional()
              : schema.default(parameter.defaultValue),
        ];
      }),
    ),
  );
}

function sdkDataFrameRowsSchema(
  returns: (typeof RESEARCH_SDK_CONTRACT_V1)['functions'][number]['returns'],
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

/**
 * 从公开 SDK 参数定义构造边界校验，避免另写运行时 schema。
 *
 * Derive request validation from public SDK parameter definitions.
 */
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
    case 'number':
      return z.number().finite();
    case 'string': {
      const schema = z.string().trim().min(1);
      return parameter.maximumLength ? schema.max(parameter.maximumLength) : schema;
    }
    case 'dataframe':
    case 'string_map':
      throw new Error(`SDK parameter ${parameter.name} cannot cross the research data bridge`);
    case 'string_or_string_list': {
      const item = parameter.values?.length
        ? z.enum(parameter.values as [string, ...string[]])
        : z.string().trim().min(1);
      const list = z
        .array(item)
        .min(1)
        .max(parameter.maximumItems ?? 100)
        .refine((values) => new Set(values).size === values.length, 'items must be unique');
      return z.union([item, list]);
    }
  }
}

/**
 * 从公开返回列定义构造响应校验，保持 Python 与宿主字段一致。
 *
 * Derive response-column validation from the public SDK contract.
 */
function sdkWireColumnSchema(column: ResearchSdkDataFrameColumnContractV1): z.ZodType {
  switch (column.wireType) {
    case 'trade_date':
      return z.string().regex(/^\d{8}$/);
    case 'nullable_trade_date':
      return z
        .string()
        .regex(/^\d{8}$/)
        .nullable();
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
