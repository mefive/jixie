import type { CreateStrategyRequest } from '@jixie/shared/api/strategy';
import type { FactorReportListRequestQuery } from '@jixie/shared/api/factor';
import type { updateResearchCell } from './research';
import type { updateFactor } from './factor';
import type { updateStrategy } from './strategy';

type AssertRejected<Value extends false> = Value;

// Keep these checks under the web application's own compiler settings. No runtime is emitted.
export type InvalidRequestAssertions = [
  AssertRejected<{} extends CreateStrategyRequest ? true : false>,
  AssertRejected<
    { name: string; start: string; end: string; initialCash: number } extends CreateStrategyRequest
      ? true
      : false
  >,
  AssertRejected<
    { factor: string; limit: boolean } extends FactorReportListRequestQuery ? true : false
  >,
  AssertRejected<
    { source: string } extends Parameters<typeof updateResearchCell>[1] ? true : false
  >,
  AssertRejected<
    {
      messages: { role: 'assistant'; parts: { type: 'embedded_analysis' }[] }[];
    } extends Parameters<typeof updateFactor>[1]
      ? true
      : false
  >,
  AssertRejected<
    { config: { code: string } } extends Parameters<typeof updateStrategy>[1] ? true : false
  >,
];
