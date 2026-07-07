import { describe, expect, it } from 'vitest';
import { runAnalysisCode } from './analyze-sandbox.js';

const DATA = {
  a: [
    { tradeDate: '20240101', close: 100 },
    { tradeDate: '20240102', close: 110 },
    { tradeDate: '20240103', close: 121 },
  ],
};

describe('runAnalysisCode(analyzeData 沙盒)', () => {
  it('执行模块并注入 data 与 stats', async () => {
    const result = await runAnalysisCode(
      `export default ({ data, stats }) => {
         const closes = data.a.map((row) => row.close);
         const returns = closes.slice(1).map((close, i) => close / closes[i] - 1);
         return { meanReturn: stats.mean(returns), n: returns.length };
       }`,
      DATA,
    );
    expect(result).toEqual({ meanReturn: expect.closeTo(0.1, 10), n: 2 });
  });

  it('容忍 TS 类型标注与 async 模块', async () => {
    const result = await runAnalysisCode(
      `export default async ({ data }: { data: any }): Promise<number> => data.a.length;`,
      DATA,
    );
    expect(result).toBe(3);
  });

  it('缺 default 导出报可读错误', async () => {
    await expect(runAnalysisCode(`export const x = 1;`, DATA)).rejects.toThrow(/export default/);
  });

  it('运行时抛错带回错误消息', async () => {
    await expect(
      runAnalysisCode(`export default () => { throw new Error('boom'); }`, DATA),
    ).rejects.toThrow(/boom/);
  });

  it('import 外部模块被拒(未使用的 import 会被 esbuild 剔除,故用例必须真的用到它)', async () => {
    await expect(
      runAnalysisCode(
        `import fs from 'fs'; export default () => fs.readFileSync('/etc/hosts');`,
        DATA,
      ),
    ).rejects.toThrow(/不能 import 外部模块/);
  });

  it('语法错误报编译失败', async () => {
    await expect(runAnalysisCode(`export default ({) => 1`, DATA)).rejects.toThrow(/编译失败/);
  });
});
