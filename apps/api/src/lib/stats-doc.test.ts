import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStatsDoc, undocumentedExports } from './stats-doc-gen.js';
import { STATS_DOC } from './stats-doc.js';

const source = readFileSync(new URL('./stats.ts', import.meta.url), 'utf8');

describe('stats-doc(agent 说明书)与 stats.ts 源码同步', () => {
  it('每个导出函数都有 JSDoc(否则 agent 看不到它)', () => {
    expect(undocumentedExports(source)).toEqual([]);
  });

  it('stats-doc.ts 与源码 JSDoc 一致(漂移请跑 pnpm --filter api gen:stats-doc)', () => {
    expect(STATS_DOC).toBe(buildStatsDoc(source));
  });

  it('说明书覆盖关键函数', () => {
    for (const name of ['pearson', 'spearman', 'linearRegression', 'quantile', 'sharpe']) {
      expect(STATS_DOC).toContain(`stats.${name}(`);
    }
  });
});
