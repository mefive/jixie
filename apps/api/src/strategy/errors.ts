import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  custom_factor_missing: {
    category: 'invalid',
    messageKey: 'customFactorMissing',
  },
  research_only_inputs_unavailable: {
    category: 'invalid',
    messageKey: 'factorResearchOnlyInputsUnavailable',
  },
  strategy_not_found: {
    category: 'missing',
    messageKey: 'strategyNotFound',
  },
  strategy_turn_in_progress: {
    category: 'conflict',
    messageKey: 'strategyTurnInProgress',
  },
  backtest_report_not_found: {
    category: 'missing',
    messageKey: 'backtestReportNotFound',
  },
  backtest_job_not_found: {
    category: 'missing',
    messageKey: 'backtestJobNotFound',
  },
  start_after_end: {
    category: 'invalid',
    messageKey: 'startAfterEnd',
  },
  strategy_backtest_in_progress: {
    category: 'conflict',
    messageKey: 'strategyBacktestInProgress',
  },
  strategy_has_deployments: {
    category: 'conflict',
    messageKey: 'strategyHasDeployments',
  },
  public_strategy_must_be_self_contained: {
    category: 'invalid',
    messageKey: 'publicStrategyMustBeSelfContained',
  },
  strategy_python_scan_unsupported: {
    category: 'invalid',
    messageKey: 'strategyPythonScanUnsupported',
  },
  strategy_scan_params_not_static: {
    category: 'invalid',
    messageKey: 'strategyScanParamsNotStatic',
  },
  strategy_scan_code_invalid: {
    category: 'invalid',
    messageKey: 'strategyScanCodeInvalid',
  },
  strategy_scan_job_not_found: {
    category: 'missing',
    messageKey: 'strategyScanJobNotFound',
  },
  strategy_scan_not_found: {
    category: 'missing',
    messageKey: 'strategyScanNotFound',
  },
  strategy_scan_invalid: {
    category: 'invalid',
    messageKey: 'strategyScanInvalid',
  },
  strategy_scan_no_parameters: {
    category: 'invalid',
    messageKey: 'strategyScanNoParameters',
  },
  strategy_scan_split_invalid: {
    category: 'invalid',
    messageKey: 'strategyScanSplitInvalid',
  },
  strategy_scan_in_progress: {
    category: 'conflict',
    messageKey: 'strategyScanInProgress',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type StrategyErrorReason = keyof typeof definitions;

export class StrategyError extends BusinessError<StrategyErrorReason> {
  constructor(reason: StrategyErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
