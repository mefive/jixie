import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  report_not_found: {
    category: 'missing',
    messageKey: 'backtestReportNotFound',
  },
  report_not_ready: {
    category: 'conflict',
    messageKey: 'deploymentReportNotReady',
  },
  dependencies_changed: {
    category: 'conflict',
    messageKey: 'deploymentReportDependenciesChanged',
  },
  language_unsupported: {
    category: 'invalid',
    messageKey: 'strategyPythonSignalsUnsupported',
  },
  futures_unsupported: {
    category: 'invalid',
    messageKey: 'strategyFutureSignalsUnsupported',
  },
  deployment_not_found: {
    category: 'missing',
    messageKey: 'strategyDeploymentNotFound',
  },
  paused: {
    category: 'conflict',
    messageKey: 'strategyDeploymentPaused',
  },
  invalid_date: {
    category: 'invalid',
    messageKey: 'signalTradeDateInvalid',
  },
  next_date_missing: {
    category: 'invalid',
    messageKey: 'signalNextTradeDateMissing',
  },
  data_not_ready: {
    category: 'conflict',
    messageKey: 'signalDataNotReady',
  },
  run_not_found: {
    category: 'missing',
    messageKey: 'signalRunNotFound',
  },
  job_not_found: {
    category: 'missing',
    messageKey: 'signalJobNotFound',
  },
  execution_not_found: {
    category: 'missing',
    messageKey: 'signalExecutionNotFound',
  },
  execution_unavailable: {
    category: 'conflict',
    messageKey: 'signalExecutionUnavailable',
  },
  execution_shares_invalid: {
    category: 'invalid',
    messageKey: 'signalExecutionUnavailable',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type SignalsErrorReason = keyof typeof definitions;

export class SignalsError extends BusinessError<SignalsErrorReason> {
  constructor(reason: SignalsErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
