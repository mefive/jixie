import { describe, expect, it } from 'vitest';
import { extractFactorKeys } from './references.js';

describe('strategy factor references', () => {
  it('finds raw keys in both the declaration and direct calls', () => {
    expect(
      extractFactorKeys(`
        export default defineStrategy({
          factors: ['book_to_market', 'mf_net_main'],
          onBar(ctx) { return ctx.factor('quality_score', '000001.SZ'); },
        });
      `),
    ).toEqual(['quality_score', 'book_to_market']);
    expect(extractFactorKeys(`strategy = Strategy(factors=["python_value"])`)).toEqual([
      'python_value',
    ]);
  });

  it('keeps direct-call order before declaration order and deduplicates across both', () => {
    expect(
      extractFactorKeys(`
        factors: ['declared_first', 'shared_key', 'declared_first'];
        ctx . factor ('called_first', 'A');
        ctx.factor("shared_key", 'A');
        ctx.factor('called_first', 'B');
        factors = ["python_last", "shared_key"];
      `),
    ).toEqual(['called_first', 'shared_key', 'declared_first', 'python_last']);
  });

  it('filters engine keys and invalid identifiers without evaluating dynamic expressions', () => {
    expect(
      extractFactorKeys(`
        factors: ['mf_net_main', 'Uppercase', 'has-dash', '1starts_with_digit', '${'a'.repeat(33)}'];
        ctx.factor('mf_net_main', 'A');
        ctx.factor('', 'A');
        ctx.factor(keyVariable, 'A');
        factors = loadFactorKeys();
      `),
    ).toEqual([]);
    expect(extractFactorKeys('')).toEqual([]);
  });
});
