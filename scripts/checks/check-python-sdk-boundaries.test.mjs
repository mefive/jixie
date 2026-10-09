import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-python-sdk-boundaries.py', import.meta.url));
const python = process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3';

function inspect(source, module) {
  return JSON.parse(
    execFileSync(
      python,
      [
        '-I',
        '-c',
        `
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("checker", sys.argv[1])
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
print(json.dumps(checker.inspect_sdk_dependencies(sys.argv[2], sys.argv[3])))
`,
        checker,
        source,
        module,
      ],
      { encoding: 'utf8' },
    ),
  );
}

test('rejects absolute and relative SDK imports of runtime and engine implementations', () => {
  assert.deepEqual(
    inspect(
      'from ..runtime.adapter import Adapter\nfrom backtesting.context import Context',
      'factor.sdk.python',
    ),
    [
      [1, 'factor.runtime.adapter'],
      [2, 'backtesting.context'],
    ],
  );
});

test('permits SDK capabilities and third-party numerical helpers without executing them', () => {
  assert.deepEqual(
    inspect(
      'from .capabilities import Capabilities\nimport numpy\nraise RuntimeError("must not execute")',
      'research.sdk.python.data',
    ),
    [],
  );
});

test('checks imports inside functions and type-checking branches', () => {
  assert.deepEqual(
    inspect(
      'if TYPE_CHECKING:\n    from strategy.runtime.adapter import Adapter\ndef execute():\n    import infra.database',
      'strategy.sdk.python',
    ),
    [
      [2, 'strategy.runtime.adapter'],
      [4, 'infra.database'],
    ],
  );
});

test('rejects dynamic runtime imports and undeclared dynamic dependencies', () => {
  assert.deepEqual(
    inspect(
      '__import__("factor.runtime.runner")\nimportlib.import_module(target)',
      'factor.sdk.python',
    ),
    [
      [1, 'factor.runtime.runner'],
      [2, '<dynamic import>'],
    ],
  );
});
