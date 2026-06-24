import type { Expr } from '@jixie/shared';

/** What an expression reads from: one stock's fields + precomputed factor columns. */
export interface ExprScope {
  field(name: string): number | null;
  factor(name: string): number | null;
}

/** Evaluate a tagged-AST expression against a scope. Returns NaN for missing inputs (callers filter
 * out non-finite scores). Pure recursion — no eval, so it's safe to run untrusted IR. */
export function evalExpr(e: Expr, scope: ExprScope): number {
  switch (e.kind) {
    case 'const':
      return e.value;
    case 'field':
      return num(scope.field(e.name));
    case 'factor':
      return num(scope.factor(e.name));
    case 'unary': {
      const v = evalExpr(e.arg, scope);
      return e.op === 'neg' ? -v : e.op === 'abs' ? Math.abs(v) : Math.log(v);
    }
    case 'binary': {
      const l = evalExpr(e.left, scope);
      const r = evalExpr(e.right, scope);
      return e.op === '+' ? l + r : e.op === '-' ? l - r : e.op === '*' ? l * r : l / r;
    }
  }
}

const num = (x: number | null): number => (x == null ? NaN : x);
