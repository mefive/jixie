import { z } from 'zod';
import {
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

export function parseResearchSeriesRuntimeRequest(value: unknown): ResearchSeriesRuntimeRequestV1 {
  return researchSeriesRequestSchema.parse(value) as unknown as ResearchSeriesRuntimeRequestV1;
}

export function parseResearchSeriesRuntimeRows(value: unknown): ResearchSeriesRuntimeRowV1[] {
  return researchSeriesRowsSchema.parse(value) as unknown as ResearchSeriesRuntimeRowV1[];
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
    case 'string':
      return z.string();
    case 'boolean':
      return z.boolean();
  }
}
