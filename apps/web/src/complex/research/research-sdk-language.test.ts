import assert from 'node:assert/strict';
import test from 'node:test';
import {
  researchSdkActiveCall,
  researchSdkCompletionContext,
  researchSdkDataFrameBindings,
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
