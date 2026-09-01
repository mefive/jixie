import assert from 'node:assert/strict';
import test from 'node:test';
import {
  researchSdkActiveCall,
  researchSdkCompletionContext,
  researchSdkDataFrameBindings,
  researchSdkStringArgument,
} from './research-sdk-language.js';

test('infers the static DataFrame schema from a direct SDK assignment', () => {
  const source = `monthly = data.series(
    "index",
    "000300.SH",
    start="20200101",
    end="20251231",
)
monthly["val`;
  const context = researchSdkCompletionContext(source, source.length);

  assert.equal(context?.kind, 'dataframe_column');
  assert.equal(context?.partial, 'val');
  if (context?.kind === 'dataframe_column') {
    assert.deepEqual(
      context.contract.returns.kind === 'dataframe'
        ? context.contract.returns.columns.map((column) => column.name)
        : [],
      ['date', 'value'],
    );
  }
});

test('infers the fixed panel columns and universe argument without executing code', () => {
  const source = `equities = data.panel(
    "index:000300.SH",
    start="20200101",
    end="20251231",
)
equities["adjusted_`;
  const context = researchSdkCompletionContext(source, source.length);

  assert.equal(context?.kind, 'dataframe_column');
  if (context?.kind === 'dataframe_column') {
    assert.equal(context.contract.qualifiedName, 'data.panel');
    assert.ok(
      context.contract.returns.kind === 'dataframe' &&
        context.contract.returns.columns.some((column) => column.name === 'adjusted_close'),
    );
  }

  const universeCall = 'data.cross_section("index:000';
  const universeContext = researchSdkCompletionContext(universeCall, universeCall.length);
  assert.equal(universeContext?.kind, 'parameter_value');
  assert.equal(universeContext?.parameterName, 'universe');
});

test('provides enum and chart column contexts without executing code', () => {
  const series = `monthly = data.series("index", "000300.SH", start="20200101", end="20251231", frequency="mon`;
  const enumContext = researchSdkCompletionContext(series, series.length);
  assert.equal(enumContext?.kind, 'parameter_value');
  assert.equal(enumContext?.parameterName, 'frequency');

  const chart = `${series}thly")\ncharts.line(monthly, x="da`;
  const chartContext = researchSdkCompletionContext(chart, chart.length);
  assert.equal(chartContext?.kind, 'parameter_value');
  assert.equal(chartContext?.frameVariable, 'monthly');
  assert.deepEqual([...researchSdkDataFrameBindings(chart).keys()], ['monthly']);

  const heatmap = `${chart.slice(0, chart.indexOf('charts.line'))}charts.heatmap(monthly, x="date", y="date", value="va`;
  const heatmapContext = researchSdkCompletionContext(heatmap, heatmap.length);
  assert.equal(heatmapContext?.kind, 'parameter_value');
  if (heatmapContext?.kind === 'parameter_value') {
    assert.equal(heatmapContext.contract.qualifiedName, 'charts.heatmap');
    assert.equal(heatmapContext.parameterName, 'value');
    assert.equal(heatmapContext.frameVariable, 'monthly');
  }
});

test('provides a catalog context for the positional identifier', () => {
  const source = 'data.series("index", "0003';
  const context = researchSdkCompletionContext(source, source.length);

  assert.equal(context?.kind, 'parameter_value');
  assert.equal(context?.parameterName, 'identifier');
  assert.equal(context?.partial, '0003');
});

test('provides the results namespace and FactorReport argument context', () => {
  const member = 'results.factor_';
  const memberContext = researchSdkCompletionContext(member, member.length);
  assert.equal(memberContext?.kind, 'namespace_member');
  assert.equal(memberContext?.namespace, 'results');

  const call = 'results.factor_report("01K5';
  const callContext = researchSdkCompletionContext(call, call.length);
  assert.equal(callContext?.kind, 'parameter_value');
  assert.equal(callContext?.parameterName, 'report_id');
});

test('does not claim an SDK return schema after a pandas method chain', () => {
  const source = `renamed = data.series(
    "index",
    "000300.SH",
    start="20200101",
    end="20251231",
).rename(columns={"value": "csi300"})
renamed["`;

  assert.equal(researchSdkCompletionContext(source, source.length), null);
});

test('tracks the active parameter across multiline calls', () => {
  const source = 'data.series("index", "000300.SH",\n  start="20200101",\n  end=';
  const activeCall = researchSdkActiveCall(source, source.length);

  assert.equal(activeCall?.contract.qualifiedName, 'data.series');
  assert.equal(activeCall?.activeParameter, 3);
});

test('reads catalog-driving asset arguments from positional and named calls', () => {
  const positional = 'data.series("index", "000300.SH", measure="market.adjusted_close';
  const positionalCall = researchSdkActiveCall(positional, positional.length);
  assert.ok(positionalCall);
  assert.equal(
    researchSdkStringArgument(positionalCall.argumentSource, positionalCall.contract, 'asset_type'),
    'index',
  );
  assert.equal(
    researchSdkStringArgument(positionalCall.argumentSource, positionalCall.contract, 'identifier'),
    '000300.SH',
  );

  const named = 'data.series(asset_type="etf", identifier="510300.SH", measure="market';
  const namedCall = researchSdkActiveCall(named, named.length);
  assert.ok(namedCall);
  assert.equal(
    researchSdkStringArgument(namedCall.argumentSource, namedCall.contract, 'asset_type'),
    'etf',
  );
});
