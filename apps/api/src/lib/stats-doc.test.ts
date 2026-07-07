import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStatsDoc, undocumentedExports } from './stats-doc-gen.js';
import { STATS_DOC } from './stats-doc.js';

const source = readFileSync(new URL('./stats.ts', import.meta.url), 'utf8');

describe('stats-doc (agent reference) stays in sync with stats.ts source', () => {
  it('every exported function has JSDoc (otherwise the agent cannot see it)', () => {
    expect(undocumentedExports(source)).toEqual([]);
  });

  it('stats-doc.ts matches the source JSDoc (on drift run pnpm --filter api gen:stats-doc)', () => {
    expect(STATS_DOC).toBe(buildStatsDoc(source));
  });

  it('the reference covers the key functions', () => {
    for (const name of ['pearson', 'spearman', 'linearRegression', 'quantile', 'sharpe']) {
      expect(STATS_DOC).toContain(`stats.${name}(`);
    }
  });
});
