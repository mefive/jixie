import { UserCodeError } from '../../errors.js';
import { transform } from 'esbuild';

/**
 * 将作者 TypeScript 编译为 CommonJS，供因子与策略沙盒准备阶段使用。
 * Compile user TypeScript to CommonJS for Factor and Strategy runtime preparation.
 */
export async function toCommonJs(source: string, noun = 'code'): Promise<string> {
  try {
    const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' });

    return code;
  } catch (e) {
    if (e instanceof Error && 'errors' in e && Array.isArray(e.errors) && e.errors.length > 0) {
      throw new UserCodeError(`${noun} compilation failed: ${e.message}`, { cause: e });
    }

    throw e;
  }
}
