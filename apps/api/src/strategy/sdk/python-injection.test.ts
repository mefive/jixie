import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('uses Strategy Python capabilities without importing a runtime', () => {
  const apiSource = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(
    process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3',
    [
      '-I',
      '-c',
      `
import json
import sys
sys.path.insert(0, sys.argv[1])
from strategy.sdk.python import Context, AttrDict
class Stock:
    equity = 1000
    available_cash = 1000
    def __init__(self): self.commands = []
    def set_target_weight(self, code, weight): self.commands.append([code, weight])
    def positions(self): return []
    def adjusted_shares(self, code): return 0
class Capabilities:
    date = "20260105"
    portfolio = AttrDict(equity=1000)
    futures = AttrDict(equity=0, available_cash=0, margin=0)
    def __init__(self): self.stock = Stock()
    def history(self, code, field, count): return [10, 12, 14]
    def load_cross_section(self, index_code=None): return []
capabilities = Capabilities()
context = Context(capabilities, {"lookback": 3})
context.stock.set_target_weight("AAA", 0.5)
assert context.sma("AAA", 3) == 12
assert context.params.lookback == 3
assert context.universe().codes() == []
assert not any(name.startswith("strategy.runtime") for name in sys.modules)
print(json.dumps({"commands": capabilities.stock.commands, "period": context.period("daily")}))
`,
      apiSource,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    commands: [['AAA', 0.5]],
    period: '20260105',
  });
});
