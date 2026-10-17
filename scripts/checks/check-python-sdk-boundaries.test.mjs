import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeTestPythonEnvironment } from '../sandbox/test-python-environment.ts';

const checker = fileURLToPath(new URL('./check-python-sdk-boundaries.py', import.meta.url));
const python = await initializeTestPythonEnvironment();

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
      'from ..sandbox.adapter import Adapter\nfrom backtesting.context import Context',
      'factor.sdk.python',
    ),
    [
      [1, 'factor.sandbox.adapter'],
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
      'if TYPE_CHECKING:\n    from strategy.sandbox.adapter import Adapter\ndef execute():\n    import infra.database',
      'strategy.sdk.python',
    ),
    [
      [2, 'strategy.sandbox.adapter'],
      [4, 'infra.database'],
    ],
  );
});

test('rejects dynamic runtime imports and undeclared dynamic dependencies', () => {
  assert.deepEqual(
    inspect(
      '__import__("factor.sandbox.runner")\nimportlib.import_module(target)',
      'factor.sdk.python',
    ),
    [
      [1, 'factor.sandbox.runner'],
      [2, '<dynamic import>'],
    ],
  );
});

test('rejects both legacy runtime and sandbox imports outside the declared SDK namespace', () => {
  for (const directory of ['runtime', 'sandbox']) {
    assert.deepEqual(
      inspect(`from helpers.${directory} import adapter`, 'research.sdk.python.data'),
      [[1, `helpers.${directory}`]],
    );
  }
});
