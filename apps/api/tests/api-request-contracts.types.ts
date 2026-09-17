import type { z } from 'zod';
import type { EmailLoginRequest } from '@jixie/shared/api/auth';
import type {
  CreateFactorDraftRequest,
  CreateFactorDraftInput,
  FactorAgentRequest,
  FactorQuestionRequest,
  FactorCorrelationRequestQuery,
  FactorCorrelationQuery,
  FactorReportListRequestQuery,
  FactorCompositeRequest,
} from '@jixie/shared/api/factor';
import type {
  ResearchAgentRequest,
  ResearchAgentTurnInput,
  ResearchEmbeddedPageRequestQuery,
} from '@jixie/shared/api/research';
import type { StrategyAgentRequest } from '@jixie/shared/api/strategy';
import type { emailLoginRequestSchema } from '#auth/schema.js';
import type { factorAgentBodySchema, factorQuestionSchema } from '#factor/schema.js';
import type { strategyAgentBodySchema } from '#strategy/schema.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

/** Checked by tsc, without executing schemas or business code. */
export type RequestContractAssertions = [
  Assert<Equal<EmailLoginRequest, z.input<typeof emailLoginRequestSchema>>>,
  Assert<Equal<StrategyAgentRequest, z.input<typeof strategyAgentBodySchema>>>,
  Assert<Equal<FactorAgentRequest, z.input<typeof factorAgentBodySchema>>>,
  Assert<Equal<FactorQuestionRequest, z.input<typeof factorQuestionSchema>>>,
  Assert<Equal<CreateFactorDraftRequest['language'], 'typescript' | 'python' | undefined>>,
  Assert<Equal<CreateFactorDraftInput['language'], 'typescript' | 'python'>>,
  Assert<Equal<ResearchAgentRequest['contextCellIds'], string[] | undefined>>,
  Assert<Equal<ResearchAgentTurnInput['contextCellIds'], string[]>>,
  Assert<Equal<FactorCorrelationRequestQuery['keys'], string>>,
  Assert<Equal<FactorCorrelationQuery['keys'], string[]>>,
  Assert<Equal<FactorReportListRequestQuery['limit'], string | undefined>>,
  Assert<Equal<ResearchEmbeddedPageRequestQuery['limit'], string | undefined>>,
  Assert<Equal<unknown extends FactorCompositeRequest['definition'] ? true : false, false>>,
];
