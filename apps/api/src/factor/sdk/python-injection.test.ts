import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('uses Factor Python capabilities without importing a runtime and preserves SDK validation', () => {
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
from factor.sdk.python import CrossSectionalFactorContext, AssetFactorContext
class History:
    has_history = True
    def history_values(self, field):
        return ["1", "2", "3"] if field == "date" else [10, 11, 12]
class Asset:
    def __init__(self):
        self.reads = 0
    def declares_input(self, field):
        return field == "etf.adjustedClose"
    def value_at(self, field, periods):
        self.reads += 1
        return [10, 12][1 - periods] if periods <= 1 else None
history = CrossSectionalFactorContext(History())
asset = Asset()
context = AssetFactorContext(asset)
assert history.history(2) == [11, 12]
assert history.history(2, "date") == ["2", "3"]
assert context.value("etf.adjustedClose") == 12
assert context.lag("etf.adjustedClose", 1) == 10
assert context.lag("etf.adjustedClose", 2) is None
reads = asset.reads
for field, periods in [("etf.adjustedClose", True), ("unknown", 0)]:
    try:
        context.lag(field, periods)
        raise AssertionError("expected SDK validation")
    except ValueError:
        pass
assert asset.reads == reads
assert not any(name.startswith("factor.runtime") for name in sys.modules)
print(json.dumps({"values": history.history(2), "reads": reads}))
`,
      apiSource,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ values: [11, 12], reads: 3 });
});
