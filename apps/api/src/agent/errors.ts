import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  code_proposal_not_found: { category: 'missing', messageKey: 'codeProposalNotFound' },
  code_proposal_conflict: { category: 'conflict', messageKey: 'codeProposalConflict' },
  turn_not_found: {
    category: 'missing',
    messageKey: 'turnNotFound',
  },
  conversation_not_found: {
    category: 'missing',
    messageKey: 'conversationNotFound',
  },
  only_get_subscribe: {
    category: 'invalid',
    messageKey: 'onlyGetSubscribe',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type AgentErrorReason = keyof typeof definitions;

export class AgentError extends BusinessError<AgentErrorReason> {
  constructor(reason: AgentErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
