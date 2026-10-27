import type { CellSeed } from './cell-seed.js';

/**
 * 创建空白研究文档的初始标题与 Cell，不查询或执行数据。
 *
 * Supply the initial title and cells for a blank document without querying or executing data.
 */
export function blankDefinition(): { title: string; cells: CellSeed[] } {
  return {
    title: '未命名量化研究',
    cells: [
      {
        kind: 'markdown',
        source: '# 研究问题\n\n先写下问题、事前假设、样本区间和判断标准，再用 Python Cell 探索。',
      },
      {
        kind: 'python',
        source:
          '# data.series() 返回平台口径一致的 pandas DataFrame\n# result = data.series("index", "000300.SH", start="20200101", end="20251231")\n',
      },
    ],
  };
}

export function legacyDefinition(title: string): { cells: CellSeed[] } {
  return {
    cells: [
      {
        kind: 'markdown',
        source: `# ${title || '历史研究'}\n\n此文档由旧版研究会话升级。右侧保留原有 Agent 对话；可在下方继续添加 Markdown 或 Python Cell。`,
      },
    ],
  };
}
