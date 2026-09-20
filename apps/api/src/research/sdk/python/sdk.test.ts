import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('uses injected data access and creates chart results without loading a runtime', () => {
  const apiSource = fileURLToPath(new URL('../../../', import.meta.url));
  const result = spawnSync(
    process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3',
    [
      '-I',
      '-c',
      `
import json
import sys
sys.path.insert(0, sys.argv[1])
from research.sdk.python.charts import _ChartResult, _ChartsApi
from research.sdk.python.data import _DataApi
from research.sdk.python.results import _ResultsApi
from research.sdk.python.valuation import _ValuationApi

class Host:
    def __init__(self):
        self.requests = []
    def request(self, method, arguments):
        self.requests.append([method, arguments])
        if method == "research_factor_report":
            return {"report_id": arguments["report_id"]}
        return {"rows": [{"date": "20260105", "value": 12.5}]}

host = Host()
rows = _DataApi(host, None).series("index", "000300.SH", start="20260101", end="20260131")
report = _ResultsApi(host, None).factor_report("report-1")
chart = _ChartsApi().line(rows, x="date", y="value")
assert isinstance(chart, _ChartResult)
assert not any(name.startswith("research.runtime") for name in sys.modules)
print(json.dumps({"rows": rows, "report": report, "chart": chart.spec, "requests": host.requests}))
`,
      apiSource,
    ],
    { timeout: 10_000, encoding: 'utf8' },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.rows).toEqual([{ date: '20260105', value: 12.5 }]);
  expect(output.report).toEqual({ report_id: 'report-1' });
  expect(output.chart).toMatchObject({ type: 'chart', kind: 'line', rows: output.rows });
  expect(output.requests).toEqual([
    [
      'research_series',
      {
        asset_type: 'index',
        identifier: '000300.SH',
        start: '20260101',
        end: '20260131',
        measure: 'market.adjusted_close',
        frequency: 'daily',
        transform: 'level',
        partial_period: 'exclude',
      },
    ],
    ['research_factor_report', { report_id: 'report-1' }],
  ]);
});
