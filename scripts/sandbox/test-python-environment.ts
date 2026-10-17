import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESEARCH_PYTHON_RUNTIME_CAPABILITIES_V1 as runtime } from '../../packages/shared/src/research-python-runtime.js';
import { packageValidation, runPython } from './python-environment.js';

const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 指定测试环境校验的仓库、显式解释器及执行边界，供入口与回归测试共用。
 *
 * Configure repository, interpreter override and execution boundaries for test initialization.
 */
export interface TestPythonEnvironmentOptions {
  directory?: string;
  executable?: string;
  run?: typeof runPython;
}

/**
 * 只读校验项目测试环境；解释器或固定依赖异常时明确失败，不安装或回退。
 *
 * Validate the test interpreter and pinned dependencies without installing or falling back.
 */
export async function requireTestPythonEnvironment(
  options: TestPythonEnvironmentOptions = {},
): Promise<string> {
  const directory = options.directory ?? projectDirectory;
  const executable =
    options.executable ??
    process.env.JIXIE_PYTHON_EXECUTABLE ??
    join(directory, '.venv', runtime.runtime, 'bin', 'python3');
  const run = options.run ?? runPython;

  try {
    if (!executable.trim()) {
      throw new Error('JIXIE_PYTHON_EXECUTABLE must not be empty');
    }

    await run(executable, ['-I', '-c', packageValidation], { directory, quiet: true });
  } catch (cause) {
    throw new Error(
      `Test Python environment is unavailable or incompatible at ${JSON.stringify(executable)}. ` +
        `Expected CPython ${runtime.python} and the pinned ${runtime.runtime} dependencies. ` +
        'Run pnpm setup:sandbox from the repository root. ' +
        'If JIXIE_PYTHON_EXECUTABLE is set, fix that environment or unset the override. ' +
        `System Python fallback is disabled. ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  return executable;
}

/**
 * 在测试收集前发布已校验解释器，所有 Worker 与子进程继承同一环境。
 *
 * Publish the validated interpreter before collection so workers and children inherit it.
 */
export async function initializeTestPythonEnvironment(): Promise<string> {
  const executable = await requireTestPythonEnvironment();
  process.env.JIXIE_PYTHON_EXECUTABLE = executable;

  return executable;
}
