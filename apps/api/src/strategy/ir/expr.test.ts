import { describe, expect, it } from 'vitest';
import type { Expr } from '@jixie/shared';
import { evalExpr, type ExprScope } from './expr.js';

const scope = (
  fields: Record<string, number | null>,
  factors: Record<string, number | null> = {},
): ExprScope => ({
  field: (n) => (n in fields ? fields[n] : null),
  factor: (n) => (n in factors ? factors[n] : null),
});

describe('evalExpr', () => {
  it('const / field / factor', () => {
    expect(evalExpr({ kind: 'const', value: 3 }, scope({}))).toBe(3);
    expect(evalExpr({ kind: 'field', name: 'pb' }, scope({ pb: 2 }))).toBe(2);
    expect(evalExpr({ kind: 'factor', name: 'mom' }, scope({}, { mom: 0.5 }))).toBe(0.5);
  });

  it('ep = 1 / peTtm', () => {
    const ep: Expr = {
      kind: 'binary',
      op: '/',
      left: { kind: 'const', value: 1 },
      right: { kind: 'field', name: 'peTtm' },
    };
    expect(evalExpr(ep, scope({ peTtm: 20 }))).toBeCloseTo(0.05);
  });

  it('size = ln(totalMv)', () => {
    const e: Expr = { kind: 'unary', op: 'ln', arg: { kind: 'field', name: 'totalMv' } };
    expect(evalExpr(e, scope({ totalMv: Math.E }))).toBeCloseTo(1);
  });

  it('arithmetic ops', () => {
    const e = (op: '+' | '-' | '*' | '/'): Expr => ({
      kind: 'binary',
      op,
      left: { kind: 'const', value: 6 },
      right: { kind: 'const', value: 3 },
    });
    expect(evalExpr(e('+'), scope({}))).toBe(9);
    expect(evalExpr(e('-'), scope({}))).toBe(3);
    expect(evalExpr(e('*'), scope({}))).toBe(18);
    expect(evalExpr(e('/'), scope({}))).toBe(2);
  });

  it('missing or null field → NaN (callers filter non-finite)', () => {
    expect(Number.isNaN(evalExpr({ kind: 'field', name: 'nope' }, scope({})))).toBe(true);
    expect(Number.isNaN(evalExpr({ kind: 'field', name: 'peTtm' }, scope({ peTtm: null })))).toBe(true);
  });
});
