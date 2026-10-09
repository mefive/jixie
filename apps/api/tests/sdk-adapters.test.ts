import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps Python adapter bindings independent while retaining session state', () => {
  const apiSource = fileURLToPath(new URL('../src/', import.meta.url));
  const result = spawnSync(
    process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3',
    [
      '-I',
      '-c',
      `
import json
import sys
sys.path.insert(0, sys.argv[1])
from factor.runtime.python.adapter import FactorAdapter
from factor.sdk.python import AssetFactorContext, CrossSectionalFactorContext
from strategy.runtime.python.adapter import StrategyAdapter
from strategy.sdk.python import Context
from research.runtime.python.adapter import ResearchAdapter

factor = FactorAdapter()
fields = {"etf.adjustedClose": [10, 12, 15]}
first = AssetFactorContext(factor.bind({"kind": "asset", "fields": fields, "index": 1, "declared_inputs": set(fields)}))
second = AssetFactorContext(factor.bind({"kind": "asset", "fields": fields, "index": 2, "declared_inputs": set(fields)}))
assert first.value("etf.adjustedClose") == 12
assert second.value("etf.adjustedClose") == 15
assert first.lag("etf.adjustedClose", 1) == 10
history = CrossSectionalFactorContext(factor.bind({"kind": "cross_sectional", "history": {"close": [10, 12]}}))
assert history.history(2) == [10, 12]

requests = []
def request(method, arguments):
    requests.append([method, arguments])
    if method == "cross_section":
        return {"codes": ["AAA"], "rows": [{"code": "AAA", "industry": "banking"}]}
    raise AssertionError("unexpected host request")

def snapshot(date, equity, close):
    return {
        "date": date,
        "portfolio": {"equity": equity},
        "stock": {"equity": equity, "availableCash": equity, "positions": []},
        "futures": {"equity": 0, "availableCash": 0, "margin": 0},
        "bar_updates": {"AAA": {"date": date, "adj_close": close}},
    }

strategy = StrategyAdapter({"request": request})
first = strategy.bind(snapshot("20260105", 1000, 10))
first_context = Context(first, {})
first_context.stock.set_target_weight("AAA", 0.5)
assert first.commands == [{"operation": "stock.setTargetWeight", "arguments": {"code": "AAA", "weight": 0.5}}]
assert requests == []
assert first_context.universe().codes() == ["AAA"]
second = strategy.bind(snapshot("20260106", 1200, 12))
second_context = Context(second, {})
assert first.date == "20260105" and first.stock.equity == 1000
assert second.date == "20260106" and second.stock.equity == 1200
assert first.industry("AAA") == "banking" and second.bar("AAA") is None
assert second_context.history("AAA", "close", 2) == [10, 12]
assert second.commands == [] and len(first.commands) == 1
second_context.stock.equal_weight(["AAA", "BBB"])
second_context.stock.order_adjusted_shares("AAA", 10)
second_context.stock.order_lots("AAA", 2)
second_context.stock.close_position("AAA")
second_context.stock.stop_loss_at_adjusted_price("AAA", 9)
second_context.stock.trailing_stop_by_fraction("AAA", 0.1)
second_context.stock.limit_buy_at_adjusted_price("AAA", 10, 5)
second_context.stock.take_profit_by_fraction("AAA", 0.2)
second_context.stock.cancel_conditional("AAA")
assert second.commands == [
    {"operation": "stock.setTargetWeights", "arguments": {"weights": {"AAA": 0.5, "BBB": 0.5}}},
    {"operation": "stock.orderAdjustedShares", "arguments": {"code": "AAA", "shares": 10}},
    {"operation": "stock.orderLots", "arguments": {"code": "AAA", "lots": 2}},
    {"operation": "stock.closePosition", "arguments": {"code": "AAA"}},
    {"operation": "stock.stopLossAtAdjustedPrice", "arguments": {"code": "AAA", "price": 9}},
    {"operation": "stock.trailingStopByFraction", "arguments": {"code": "AAA", "percentage": 0.1}},
    {"operation": "stock.limitBuyAtAdjustedPrice", "arguments": {"code": "AAA", "price": 10, "shares": 5}},
    {"operation": "stock.takeProfitByFraction", "arguments": {"code": "AAA", "percentage": 0.2}},
    {"operation": "stock.cancelConditional", "arguments": {"code": "AAA", "kind": None}},
]
assert len(requests) == 1

frames = []
def read_frame():
    return {"type": "response", "id": frames[-1]["id"], "result": frames[-1]["arguments"]}
input = {"read_frame": read_frame, "send_frame": frames.append}
research = ResearchAdapter()
first = research.bind(input)
assert first.request("research_series", {"identifier": "AAA"}) == {"identifier": "AAA"}
second = research.bind(input)
assert second.request("research_series", {"identifier": "BBB"}) == {"identifier": "BBB"}
assert first.request("research_factor_report", {"report_id": "report-1"}) == {"report_id": "report-1"}
assert [frame["id"] for frame in frames] == [1, 2, 3]
print(json.dumps({"factor": True, "strategy": True, "research": True}))
`,
      apiSource,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ factor: true, strategy: true, research: true });
});
