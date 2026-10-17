import { defineConfig } from 'vitest/config';
import { initializeTestPythonEnvironment } from '../../scripts/sandbox/test-python-environment.js';

export default defineConfig(async () => {
  const pythonExecutable = await initializeTestPythonEnvironment();

  return {
    resolve: { conditions: ['development'] },
    // 每个文件独立进程；已校验解释器通过测试环境继续传给子进程。
    // Isolate each file and pass the validated interpreter to workers and their children.
    test: {
      pool: 'forks',
      execArgv: ['--conditions=development'],
      env: { JIXIE_PYTHON_EXECUTABLE: pythonExecutable },
    },
  };
});
