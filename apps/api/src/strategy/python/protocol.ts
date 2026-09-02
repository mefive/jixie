import { z } from 'zod';

const MAX_ERROR_CHARACTERS = 256 * 1024;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_LIST_ITEMS = 10_000;
const MAX_LOG_CHARACTERS = 20_000;
const MAX_OUTPUT_CHARACTERS = 8 * 1024 * 1024;
const MAX_FACTOR_VALUES = 1_000_000;

const finiteNumberSchema = z.number().finite();
const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_CHARACTERS);
const identifierListSchema = z.array(identifierSchema).max(MAX_LIST_ITEMS);
const uniqueIdentifierListSchema = identifierListSchema.refine(
  (values) => new Set(values).size === values.length,
  'identifiers must be unique',
);
const stringListSchema = z.array(z.string().max(MAX_IDENTIFIER_CHARACTERS)).max(MAX_LIST_ITEMS);
const scalarSchema = z.union([z.string(), finiteNumberSchema, z.boolean(), z.null()]);
const tableScalarSchema = z.union([z.string().max(256), finiteNumberSchema, z.boolean(), z.null()]);
const strategyNameSchema = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, 'name must not be blank');
const strategyParameterStringSchema = z
  .string()
  .max(100)
  .refine((value) => value.trim().length > 0, 'parameter must not be blank');

const runtimeLogFrameSchema = z.strictObject({
  type: z.literal('log'),
  level: z.enum(['info', 'warning', 'error']),
  text: z.string().max(MAX_LOG_CHARACTERS),
});

const runtimeErrorFrameSchema = z.union([
  z.strictObject({
    type: z.literal('error'),
    message: z.string().max(MAX_ERROR_CHARACTERS),
  }),
  z.strictObject({
    type: z.literal('fatal'),
    message: z.string().max(MAX_ERROR_CHARACTERS),
  }),
]);

const strategyAccountsSchema = z
  .strictObject({
    stock: z.strictObject({ cashWeight: finiteNumberSchema.min(0).max(1) }),
    futures: z.strictObject({ cashWeight: finiteNumberSchema.min(0).max(1) }),
  })
  .refine(
    (accounts) => Math.abs(accounts.stock.cashWeight + accounts.futures.cashWeight - 1) <= 1e-9,
    'account cash weights must sum to 1',
  );

const strategyMetadataSchema = z.strictObject({
  name: strategyNameSchema,
  params: boundedRecord(z.union([finiteNumberSchema, strategyParameterStringSchema]), 256),
  factors: uniqueIdentifierListSchema,
  watch: uniqueIdentifierListSchema,
  futures: uniqueIdentifierListSchema,
  accounts: strategyAccountsSchema.nullable(),
});

const strategyReadyFrameSchema = z.strictObject({
  type: z.literal('ready'),
  metadata: strategyMetadataSchema,
});

const strategyRequestFrameSchema = z.union([
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.literal('cross_section'),
    arguments: z.strictObject({
      index_code: identifierSchema.nullable(),
    }),
  }),
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.literal('bars'),
    arguments: z.strictObject({
      codes: uniqueIdentifierListSchema,
    }),
  }),
]);

const strategyCommandSchema = z.discriminatedUnion('operation', [
  commandSchema('order_target_percent', {
    code: identifierSchema,
    weight: finiteNumberSchema,
  }),
  commandSchema('set_holdings', {
    weights: boundedRecord(finiteNumberSchema, MAX_LIST_ITEMS),
  }),
  commandSchema('order', {
    code: identifierSchema,
    shares: finiteNumberSchema,
  }),
  commandSchema('order_lots', {
    code: identifierSchema,
    lots: finiteNumberSchema,
  }),
  commandSchema('exit', { code: identifierSchema }),
  commandSchema('stop_loss', {
    code: identifierSchema,
    price: finiteNumberSchema,
  }),
  commandSchema('trailing_stop', {
    code: identifierSchema,
    percentage: finiteNumberSchema,
  }),
  commandSchema('limit_buy', {
    code: identifierSchema,
    price: finiteNumberSchema,
    shares: finiteNumberSchema,
  }),
  commandSchema('take_profit', {
    code: identifierSchema,
    percentage: finiteNumberSchema,
  }),
  commandSchema('cancel_conditional', {
    code: identifierSchema,
    kind: z.enum(['stop_loss', 'trailing_stop', 'limit_buy', 'take_profit']).nullable(),
  }),
]);

const strategyDoneFrameSchema = z.strictObject({
  type: z.literal('done'),
  commands: z.array(strategyCommandSchema).max(MAX_LIST_ITEMS),
});

export const strategyStartupFrameSchema = z.union([
  runtimeLogFrameSchema,
  strategyReadyFrameSchema,
  runtimeErrorFrameSchema,
]);

export const strategyExecutionFrameSchema = z.union([
  runtimeLogFrameSchema,
  strategyRequestFrameSchema,
  strategyDoneFrameSchema,
  runtimeErrorFrameSchema,
]);

const crossSectionalFactorMetadataSchema = z.strictObject({
  name: strategyNameSchema,
  window: z.number().int().min(1).max(505).nullable(),
  min_coverage: finiteNumberSchema.min(0.1).max(1).nullable(),
  analysis_kind: z.literal('cross_sectional'),
  inputs: z.array(z.never()).max(0),
  target_asset_classes: z.array(z.never()).max(0),
});

const assetFactorMetadataSchema = z.strictObject({
  name: strategyNameSchema,
  window: z.number().int().min(2).max(505),
  min_coverage: z.null(),
  analysis_kind: z.enum(['time_series', 'panel']),
  inputs: uniqueIdentifierListSchema.min(1).max(256),
  target_asset_classes: z
    .array(z.enum(['equity', 'fixed_income', 'commodity']))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length, 'asset classes must be unique'),
});

const factorReadyFrameSchema = z.strictObject({
  type: z.literal('factor_ready'),
  metadata: z.union([crossSectionalFactorMetadataSchema, assetFactorMetadataSchema]),
});

const factorValuesFrameSchema = z.strictObject({
  type: z.literal('factor_values'),
  values: z.array(finiteNumberSchema.nullable()).max(MAX_FACTOR_VALUES),
  first_error: z.string().max(MAX_ERROR_CHARACTERS).nullable(),
});

export const factorStartupFrameSchema = z.union([
  runtimeLogFrameSchema,
  factorReadyFrameSchema,
  runtimeErrorFrameSchema,
]);

export const factorExecutionFrameSchema = z.union([
  runtimeLogFrameSchema,
  factorValuesFrameSchema,
  runtimeErrorFrameSchema,
]);

const researchEnvironmentSchema = z.strictObject({
  runtime: z.literal('research-py-v1'),
  python: z.string().max(64),
  numpy: z.string().max(64).nullable(),
  pandas: z.string().max(64).nullable(),
  matplotlib: z.string().max(64).nullable(),
  scipy: z.string().max(64).nullable(),
  statsmodels: z.string().max(64).nullable(),
  'scikit-learn': z.string().max(64).nullable(),
});

const researchReadyFrameSchema = z.strictObject({
  type: z.literal('research_ready'),
  environment: researchEnvironmentSchema,
});

const researchAnalysisRequestSchema = z.strictObject({
  line: z.number().int().positive(),
  asset_type: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
  identifier: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
  measure: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
});

const researchYieldCurveAnalysisRequestSchema = z.strictObject({
  line: z.number().int().positive(),
  curve: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
  tenor: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
});

const researchMacroAnalysisRequestSchema = z.strictObject({
  line: z.number().int().positive(),
  series: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
});

const researchFxAnalysisRequestSchema = z.strictObject({
  line: z.number().int().positive(),
  pair: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
});

const researchCommodityAnalysisRequestSchema = z.strictObject({
  line: z.number().int().positive(),
  method: z.enum(['commodity_returns', 'commodity_warehouse_receipts', 'commodity_holdings']),
  product: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
});

const researchEquityAnalysisRequestSchema = z.strictObject({
  line: z.number().int().positive(),
  method: z.enum([
    'equity_fundamentals',
    'equity_flows',
    'equity_dividends',
    'etf_shares',
    'index_valuation',
    'industry_state',
    'futures_settlement',
  ]),
  identifier: z.string().max(MAX_IDENTIFIER_CHARACTERS).nullable(),
});

const researchAnalyzedFrameSchema = z.strictObject({
  type: z.literal('research_analyzed'),
  cells: z
    .array(
      z.strictObject({
        cell_id: identifierSchema,
        definitions: stringListSchema,
        references: stringListSchema,
        imports: stringListSchema,
        series_requests: z.array(researchAnalysisRequestSchema).max(MAX_LIST_ITEMS),
        yield_curve_requests: z.array(researchYieldCurveAnalysisRequestSchema).max(MAX_LIST_ITEMS),
        macro_requests: z.array(researchMacroAnalysisRequestSchema).max(MAX_LIST_ITEMS),
        fx_requests: z.array(researchFxAnalysisRequestSchema).max(MAX_LIST_ITEMS),
        commodity_requests: z.array(researchCommodityAnalysisRequestSchema).max(MAX_LIST_ITEMS),
        equity_requests: z.array(researchEquityAnalysisRequestSchema).max(MAX_LIST_ITEMS),
        error: z.string().max(MAX_ERROR_CHARACTERS).optional(),
      }),
    )
    .max(MAX_LIST_ITEMS),
});

const researchTextOutputSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().max(MAX_OUTPUT_CHARACTERS),
  level: z.enum(['info', 'warning', 'error']).optional(),
});

const researchValueOutputSchema = z.strictObject({
  type: z.literal('value'),
  value: z.union([scalarSchema, z.array(scalarSchema).max(200)]),
});

const researchTableOutputSchema = z.strictObject({
  type: z.literal('table'),
  columns: z.array(z.string().max(80)).max(64),
  rows: z.array(boundedWireRecord(tableScalarSchema, 64)).max(200),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  columnCount: z.number().int().nonnegative().optional(),
  truncatedColumns: z.boolean().optional(),
  truncatedCells: z.boolean().optional(),
  truncatedBytes: z.boolean().optional(),
  previewByteSize: z.number().int().nonnegative().optional(),
  limits: z
    .strictObject({
      rows: z.number().int().positive(),
      columns: z.number().int().positive(),
      cellCharacters: z.number().int().positive(),
      bytes: z.number().int().positive().optional(),
    })
    .optional(),
});

const researchChartOutputSchema = z.strictObject({
  type: z.literal('chart'),
  version: z.literal(1),
  title: z.string().max(1_000).optional(),
  kind: z.enum(['line', 'bar', 'scatter', 'area', 'histogram', 'boxplot', 'heatmap', 'event_path']),
  x: z.string().max(80),
  y: z.string().max(80).optional(),
  series: z
    .array(
      z.strictObject({
        column: z.string().max(80),
        label: z.string().max(1_000).optional(),
        type: z.enum(['line', 'bar']).optional(),
        yAxis: z.enum(['left', 'right']).optional(),
      }),
    )
    .max(20),
  rows: z.array(boundedWireRecord(scalarSchema, 64)).max(5_000),
});

const researchImageOutputSchema = z.strictObject({
  type: z.literal('image'),
  mimeType: z.literal('image/png'),
  alt: z.string().max(1_000).optional(),
  byteSize: z
    .number()
    .int()
    .nonnegative()
    .max(4 * 1024 * 1024),
  dataUrl: z
    .string()
    .startsWith('data:image/png;base64,')
    .max(6 * 1024 * 1024),
});

const researchOutputSchema = z.discriminatedUnion('type', [
  researchTextOutputSchema,
  researchValueOutputSchema,
  researchTableOutputSchema,
  researchChartOutputSchema,
  researchImageOutputSchema,
]);

const researchExecutedFrameSchema = z.strictObject({
  type: z.literal('research_executed'),
  outputs: z.array(researchOutputSchema).max(1_000),
  definitions: stringListSchema,
  references: stringListSchema,
});

const researchErrorFrameSchema = z.strictObject({
  type: z.literal('research_error'),
  message: z.string().max(MAX_ERROR_CHARACTERS),
  definitions: stringListSchema,
  references: stringListSchema,
});

const researchResetDoneFrameSchema = z.strictObject({
  type: z.literal('research_reset_done'),
});

export const researchStartupFrameSchema = z.union([
  runtimeLogFrameSchema,
  researchReadyFrameSchema,
  runtimeErrorFrameSchema,
]);

export const researchAnalysisFrameSchema = z.union([
  runtimeLogFrameSchema,
  researchAnalyzedFrameSchema,
  runtimeErrorFrameSchema,
]);

export const researchExecutionFrameSchema = z.union([
  runtimeLogFrameSchema,
  researchExecutedFrameSchema,
  researchErrorFrameSchema,
  runtimeErrorFrameSchema,
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.enum([
      'research_series',
      'research_yield_curve',
      'research_macro',
      'research_fx',
      'research_commodity_returns',
      'research_commodity_warehouse_receipts',
      'research_commodity_holdings',
      'research_market_state',
      'research_equity_fundamentals',
      'research_equity_flows',
      'research_equity_dividends',
      'research_etf_shares',
      'research_index_valuation',
      'research_industry_state',
      'research_futures_settlement',
      'research_strategy_scan_report',
      'research_factor_weather',
      'research_cross_section',
      'research_panel',
      'research_factor_report',
      'research_backtest_report',
    ]),
    arguments: z.unknown(),
  }),
]);

export const researchResetFrameSchema = z.union([
  researchResetDoneFrameSchema,
  runtimeErrorFrameSchema,
]);

export type StrategyCommand = z.infer<typeof strategyCommandSchema>;
export type StrategyRequestFrame = z.infer<typeof strategyRequestFrameSchema>;
export type ResearchRequestFrame = Extract<
  z.infer<typeof researchExecutionFrameSchema>,
  { type: 'request' }
>;

function commandSchema<Operation extends string, Shape extends z.ZodRawShape>(
  operation: Operation,
  argumentsShape: Shape,
) {
  return z.strictObject({
    operation: z.literal(operation),
    arguments: z.strictObject(argumentsShape),
  });
}

function boundedRecord<Value extends z.ZodType>(
  valueSchema: Value,
  maximumEntries: number,
): z.ZodType<Record<string, z.output<Value>>> {
  return z
    .record(z.string().min(1).max(MAX_IDENTIFIER_CHARACTERS), valueSchema)
    .refine(
      (value) => Object.keys(value).length <= maximumEntries,
      `record must contain at most ${maximumEntries} entries`,
    );
}

function boundedWireRecord<Value extends z.ZodType>(
  valueSchema: Value,
  maximumEntries: number,
): z.ZodType<Record<string, z.output<Value>>> {
  return z
    .record(z.string().max(80), valueSchema)
    .refine(
      (value) => Object.keys(value).length <= maximumEntries,
      `record must contain at most ${maximumEntries} entries`,
    );
}
