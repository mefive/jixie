import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  sql_single_statement: {
    category: 'invalid',
    messageKey: 'sqlSingleStatement',
  },
  sql_select_required: {
    category: 'invalid',
    messageKey: 'sqlSelectRequired',
  },
  sql_forbidden_keyword: {
    category: 'invalid',
    messageKey: 'sqlForbiddenKeyword',
  },
  sql_forbidden_table: {
    category: 'invalid',
    messageKey: 'sqlForbiddenTable',
  },
  sql_table_not_allowed: {
    category: 'invalid',
    messageKey: 'sqlTableNotAllowed',
  },
  sql_limit_exceeded: {
    category: 'invalid',
    messageKey: 'sqlLimitExceeded',
  },
  chart_columns_missing: {
    category: 'invalid',
    messageKey: 'chartColumnsMissing',
  },
  chart_rows_invalid: {
    category: 'invalid',
    messageKey: 'chartRowsInvalid',
  },
  chart_rows_empty: {
    category: 'invalid',
    messageKey: 'chartRowsEmpty',
  },
  chart_row_limit: {
    category: 'invalid',
    messageKey: 'chartRowLimit',
  },
  chart_rows_flat: {
    category: 'invalid',
    messageKey: 'chartRowsFlat',
  },
  chart_field_scalar: {
    category: 'invalid',
    messageKey: 'chartFieldScalar',
  },
  chart_query_names_unique: {
    category: 'invalid',
    messageKey: 'chartQueryNamesUnique',
  },
  sql_execution_invalid: {
    category: 'invalid',
    messageKey: 'sqlExecutionInvalid',
  },
  sql_timeout: {
    category: 'invalid',
    messageKey: 'sqlTimeout',
  },
  chart_code_invalid: {
    category: 'invalid',
    messageKey: 'chartCodeInvalid',
  },
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
