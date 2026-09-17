import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  correlation_key_count: {
    category: 'invalid',
    messageKey: 'correlationKeyCount',
  },
  source_protocol_invalid: {
    category: 'invalid',
    messageKey: 'windowNotComputed',
  },
  data_not_ready: {
    category: 'conflict',
    messageKey: 'windowNotComputed',
  },
  holdout_unavailable: {
    category: 'conflict',
    messageKey: 'windowNotComputed',
  },
  question_refresh_required: {
    category: 'invalid',
    messageKey: 'factorQuestionRefreshRequired',
  },
  code_invalid: {
    category: 'invalid',
    messageKey: 'codeDiagnostics',
  },
  factor_not_found: {
    category: 'missing',
    messageKey: 'factorNotFound',
  },
  published_factor_readonly: {
    category: 'conflict',
    messageKey: 'publishedFactorReadonly',
  },
  factor_turn_in_progress: {
    category: 'conflict',
    messageKey: 'factorTurnInProgress',
  },
  unknown_factor: {
    category: 'invalid',
    messageKey: 'unknownFactor',
  },
  factor_key_unavailable: {
    category: 'conflict',
    messageKey: 'factorKeyUnavailable',
  },
  factor_analysis_kind_unsupported: {
    category: 'invalid',
    messageKey: 'factorAnalysisKindUnsupported',
  },
  factor_publish_report_invalid: {
    category: 'invalid',
    messageKey: 'factorPublishReportInvalid',
  },
  window_not_computed: {
    category: 'invalid',
    messageKey: 'windowNotComputed',
  },
  evaluation_not_found: {
    category: 'missing',
    messageKey: 'windowNotComputed',
  },
  start_after_end: {
    category: 'invalid',
    messageKey: 'startAfterEnd',
  },
  factor_job_not_found: {
    category: 'missing',
    messageKey: 'factorJobNotFound',
  },
  factor_code_invalid: {
    category: 'invalid',
    messageKey: 'factorCodeInvalid',
  },
  preset_factor_readonly_edit: {
    category: 'conflict',
    messageKey: 'presetFactorReadonlyEdit',
  },
  pinned_factor_readonly_edit: {
    category: 'conflict',
    messageKey: 'pinnedFactorReadonlyEdit',
  },
  preset_factor_readonly_delete: {
    category: 'conflict',
    messageKey: 'presetFactorReadonlyDelete',
  },
  published_factor_cannot_delete: {
    category: 'conflict',
    messageKey: 'publishedFactorCannotDelete',
  },
  pinned_factor_readonly_delete: {
    category: 'conflict',
    messageKey: 'pinnedFactorReadonlyDelete',
  },
  name_failed: {
    category: 'unavailable',
    messageKey: 'nameFailed',
  },
  factor_criterion_unsupported: {
    category: 'invalid',
    messageKey: 'factorCriterionUnsupported',
  },
  factor_unavailable: {
    category: 'missing',
    messageKey: 'unknownFactor',
  },
  factor_research_assets_unsupported: {
    category: 'invalid',
    messageKey: 'factorResearchAssetsUnsupported',
  },
  asset_must_be_published_before_sharing: {
    category: 'conflict',
    messageKey: 'assetMustBePublishedBeforeSharing',
  },
  factor_question_report_unavailable: {
    category: 'invalid',
    messageKey: 'factorQuestionReportUnavailable',
  },
  factor_question_context_too_large: {
    category: 'invalid',
    messageKey: 'factorQuestionContextTooLarge',
  },
  factor_weather_requires_finalized: {
    category: 'conflict',
    messageKey: 'factorWeatherRequiresFinalized',
  },
  factor_weather_direction_required: {
    category: 'invalid',
    messageKey: 'factorWeatherDirectionRequired',
  },
  factor_weather_pin_not_found: {
    category: 'missing',
    messageKey: 'factorWeatherPinNotFound',
  },
  factor_weather_running_cannot_unpin: {
    category: 'conflict',
    messageKey: 'factorWeatherRunningCannotUnpin',
  },
  publication_not_found: {
    category: 'missing',
    messageKey: 'factorNotFound',
  },
  publication_not_draft: {
    category: 'conflict',
    messageKey: 'publishedFactorReadonly',
  },
  publication_report_invalid: {
    category: 'invalid',
    messageKey: 'factorPublishReportInvalid',
  },
  publication_report_outdated: {
    category: 'conflict',
    messageKey: 'factorPublishReportOutdated',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type FactorErrorReason = keyof typeof definitions;

export class FactorError extends BusinessError<FactorErrorReason> {
  constructor(reason: FactorErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
