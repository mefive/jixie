/**
 * 读取 Vitest 配置校验后注入的解释器，防止测试自行选择系统 Python。
 *
 * Read the interpreter validated by Vitest configuration instead of choosing system Python.
 */
export function testPythonExecutable(): string {
  const executable = process.env.JIXIE_PYTHON_EXECUTABLE;
  if (!executable) {
    throw new Error(
      'Test Python was not initialized. Run tests with the API Vitest configuration after pnpm setup:sandbox.',
    );
  }

  return executable;
}
