import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';
import type {
  ResearchCellOutputBlockV1,
  ResearchDependencyConflictV1,
  ResearchEmbeddedErrorCodeV1,
} from '@jixie/shared';

const definitions = {
  curator_disposition_invalid: {
    category: 'invalid',
    messageKey: 'researchCuratorDispositionInvalid',
  },
  language_position_invalid: {
    category: 'invalid',
    messageKey: 'researchLanguagePositionInvalid',
  },
  language_rename_invalid: {
    category: 'invalid',
    messageKey: 'researchLanguageRenameInvalid',
  },
  language_unavailable: {
    category: 'unavailable',
    messageKey: 'researchLanguageServiceUnavailable',
  },
  universe_unknown_measure: {
    category: 'invalid',
    messageKey: 'universeUnknownMeasure',
  },
  universe_duplicate_measure: {
    category: 'invalid',
    messageKey: 'universeDuplicateMeasure',
  },
  universe_numeric_predicate: {
    category: 'invalid',
    messageKey: 'universeNumericPredicate',
  },
  document_not_found: {
    category: 'missing',
    messageKey: 'conversationNotFound',
  },
  backtest_report_not_found: {
    category: 'missing',
    messageKey: 'backtestReportNotFound',
  },
  execution_not_found: {
    category: 'missing',
    messageKey: 'researchExecutionNotFound',
  },
  artifact_not_found: {
    category: 'missing',
    messageKey: 'researchArtifactNotFound',
  },
  proposal_not_found: {
    category: 'missing',
    messageKey: 'researchCellChangeProposalNotFound',
  },
  attempt_not_found: {
    category: 'missing',
    messageKey: 'researchCellChangeAttemptNotFound',
  },
  curator_run_not_found: {
    category: 'missing',
    messageKey: 'researchCuratorRunNotFound',
  },
  curator_finding_not_found: {
    category: 'missing',
    messageKey: 'researchCuratorFindingNotFound',
  },
  document_run_in_progress: {
    category: 'conflict',
    messageKey: 'researchDocumentRunInProgress',
  },
  cell_change_review_open: {
    category: 'conflict',
    messageKey: 'researchCellChangeReviewMustResolve',
  },
  execution_promotion_unavailable: {
    category: 'conflict',
    messageKey: 'researchExecutionPromotionUnavailable',
  },
  factor_draft_unavailable: {
    category: 'conflict',
    messageKey: 'researchFactorDraftUnavailable',
  },
  strategy_draft_unavailable: {
    category: 'conflict',
    messageKey: 'researchStrategyDraftUnavailable',
  },
  factor_handoff_rejected: {
    category: 'invalid',
    messageKey: 'researchHandoffRejected',
  },
  strategy_handoff_rejected: {
    category: 'invalid',
    messageKey: 'researchHandoffRejected',
  },
  cell_revision_conflict: {
    category: 'conflict',
    messageKey: 'researchCellRevisionConflict',
  },
  document_revision_conflict: {
    category: 'conflict',
    messageKey: 'researchCellChangeReviewDocumentChanged',
  },
  dependency_blocked: {
    category: 'invalid',
    messageKey: 'researchCellDependencyBlocked',
  },
  agent_conversation_not_found: {
    category: 'missing',
    messageKey: 'conversationNotFound',
  },
  agent_conversation_running: {
    category: 'conflict',
    messageKey: 'conversationTurnInProgress',
  },
  agent_clarification_pending: {
    category: 'conflict',
    messageKey: 'researchClarificationPending',
  },
  agent_attempt_not_found: {
    category: 'missing',
    messageKey: 'researchCellChangeAttemptNotFound',
  },
  clarification_not_found: {
    category: 'missing',
    messageKey: 'researchClarificationNotFound',
  },
  clarification_already_resolved: {
    category: 'conflict',
    messageKey: 'researchClarificationAlreadyResolved',
  },
  clarification_invalid_answer: {
    category: 'invalid',
    messageKey: 'researchClarificationInvalidAnswer',
  },
  review_delete_requires_explicit_application: {
    category: 'invalid',
    messageKey: 'researchCellChangeReviewDeleteRequiresApplication',
    details: {
      reason: 'delete_requires_explicit_application',
    },
  },
  review_not_open: {
    category: 'conflict',
    messageKey: 'researchCellChangeReviewNotOpen',
    details: {
      reason: 'review_not_open',
    },
  },
  review_already_open: {
    category: 'conflict',
    messageKey: 'researchCellChangeReviewAlreadyOpen',
    details: {
      reason: 'review_already_open',
    },
  },
  review_document_running: {
    category: 'conflict',
    messageKey: 'researchDocumentRunInProgress',
    details: {
      reason: 'document_running',
    },
  },
  review_document_changed: {
    category: 'conflict',
    messageKey: 'researchCellChangeReviewDocumentChanged',
    details: {
      reason: 'document_changed',
    },
  },
  attempt_proposal_not_applied: {
    category: 'conflict',
    messageKey: 'researchCellChangeAttemptProposalNotApplied',
    details: {
      reason: 'proposal_not_applied',
    },
  },
  attempt_proposal_revision_unavailable: {
    category: 'conflict',
    messageKey: 'researchCellChangeAttemptRevisionUnavailable',
    details: {
      reason: 'proposal_revision_unavailable',
    },
  },
  attempt_document_changed: {
    category: 'conflict',
    messageKey: 'researchCellChangeAttemptDocumentChanged',
    details: {
      reason: 'document_changed',
    },
  },
  attempt_no_executable_cells: {
    category: 'invalid',
    messageKey: 'researchCellChangeAttemptNoExecutableCells',
    details: {
      reason: 'no_executable_cells',
    },
  },
  affected_duplicate_definitions: {
    category: 'invalid',
    messageKey: 'researchAffectedRunDuplicateDefinitions',
  },
  affected_cyclic_dependency: {
    category: 'invalid',
    messageKey: 'researchAffectedRunCyclicDependency',
  },
  embedded_not_found: {
    category: 'missing',
    messageKey: 'researchEmbeddedNotFound',
    details: {
      reason: 'not_found',
    },
  },
  embedded_frozen: {
    category: 'conflict',
    messageKey: 'researchEmbeddedFrozen',
    details: {
      reason: 'frozen',
    },
  },
  embedded_revision_conflict: {
    category: 'conflict',
    messageKey: 'researchEmbeddedRevisionConflict',
    details: {
      reason: 'revision_conflict',
    },
  },
  embedded_run_in_progress: {
    category: 'conflict',
    messageKey: 'researchEmbeddedRunInProgress',
    details: {
      reason: 'run_in_progress',
    },
  },
  embedded_request_conflict: {
    category: 'conflict',
    messageKey: 'researchEmbeddedRequestConflict',
    details: {
      reason: 'request_conflict',
    },
  },
  embedded_invalid_report: {
    category: 'invalid',
    messageKey: 'researchEmbeddedInvalidReport',
    details: {
      reason: 'invalid_report',
    },
  },
  embedded_input_limit: {
    category: 'invalid',
    messageKey: 'researchEmbeddedInputLimit',
    details: {
      reason: 'input_limit',
    },
  },
  embedded_request_limit: {
    category: 'invalid',
    messageKey: 'researchEmbeddedRequestLimit',
    details: {
      reason: 'request_limit',
    },
  },
  embedded_timeout: {
    category: 'unavailable',
    messageKey: 'researchEmbeddedTimeout',
    details: {
      reason: 'timeout',
    },
  },
  embedded_cancelled: {
    category: 'conflict',
    messageKey: 'researchEmbeddedCancelled',
    details: {
      reason: 'cancelled',
    },
  },
  embedded_interrupted: {
    category: 'conflict',
    messageKey: 'researchEmbeddedInterrupted',
    details: {
      reason: 'interrupted',
    },
  },
  embedded_execution_failed: {
    category: 'unavailable',
    messageKey: 'researchEmbeddedExecutionFailed',
    details: {
      reason: 'execution_failed',
    },
  },
  embedded_incomplete_run: {
    category: 'conflict',
    messageKey: 'researchEmbeddedIncompleteRun',
    details: {
      reason: 'incomplete_run',
    },
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type ResearchErrorReason = keyof typeof definitions;

interface ResearchErrorDetails {
  cell_revision_conflict: {
    reason: 'cell_revision_changed';
    currentCell: { id: string; source: string; revision: number };
  };
  document_revision_conflict: { currentContentRevision: number };
  dependency_blocked: { cellIds: string[] };
  affected_duplicate_definitions: {
    reason: 'duplicate_definitions';
    conflicts: ResearchDependencyConflictV1[];
  };
  affected_cyclic_dependency: { reason: 'cyclic_dependency'; cellIds: string[] };
}

type ResearchErrorOptions<Reason extends ResearchErrorReason> = Omit<
  BusinessErrorOptions,
  'details'
> & {
  details?: Reason extends keyof ResearchErrorDetails ? ResearchErrorDetails[Reason] : unknown;
};

const embeddedCodes: Partial<Record<ResearchErrorReason, ResearchEmbeddedErrorCodeV1>> = {
  embedded_not_found: 'not_found',
  embedded_frozen: 'frozen',
  embedded_revision_conflict: 'revision_conflict',
  embedded_run_in_progress: 'run_in_progress',
  embedded_request_conflict: 'request_conflict',
  embedded_invalid_report: 'invalid_report',
  embedded_input_limit: 'input_limit',
  embedded_request_limit: 'request_limit',
  embedded_timeout: 'timeout',
  embedded_cancelled: 'cancelled',
  embedded_interrupted: 'interrupted',
  embedded_execution_failed: 'execution_failed',
  embedded_incomplete_run: 'incomplete_run',
};

export class ResearchError<
  Reason extends ResearchErrorReason = ResearchErrorReason,
> extends BusinessError<Reason> {
  readonly embeddedCode: ResearchEmbeddedErrorCodeV1 | undefined;
  constructor(reason: Reason, options: ResearchErrorOptions<Reason> = {}) {
    super(reason, definitions[reason], options);
    this.embeddedCode = embeddedCodes[reason];
  }
}

export class JsonRpcResponseError extends Error {
  public constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'JsonRpcResponseError';
  }
}

export class ResearchPythonExecutionError extends Error {
  public constructor(
    message: string,
    public readonly outputs: ResearchCellOutputBlockV1[],
    public readonly definitions: string[],
    public readonly references: string[],
    public readonly environmentFingerprint: string,
  ) {
    super(message);
    this.name = 'ResearchPythonExecutionError';
  }
}

export class ResearchPythonInterruptionError extends Error {
  public constructor(public readonly environmentFingerprint: string) {
    super('Research cell execution was interrupted');
    this.name = 'ResearchPythonInterruptionError';
  }
}
