import { z } from 'zod';
import {
  RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1,
  RESEARCH_PANEL_SDK_CONTRACT_V1,
  RESEARCH_SERIES_SDK_CONTRACT_V1,
  type ResearchAssetTypeV1,
  type ResearchFrequencyV1,
  type ResearchSdkDataFrameColumnContractV1,
  type ResearchSdkParameterContractV1,
  type ResearchTransformV1,
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
