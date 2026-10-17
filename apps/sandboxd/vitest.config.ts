import { defineConfig } from 'vitest/config';
import { initializeTestPythonEnvironment } from '../../scripts/sandbox/test-python-environment.js';

export default defineConfig(async () => {
  const pythonExecutable = await initializeTestPythonEnvironment();

  return { test: { env: { JIXIE_PYTHON_EXECUTABLE: pythonExecutable } } };
});
