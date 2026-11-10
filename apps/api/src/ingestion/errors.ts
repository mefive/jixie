import { BusinessError, type BusinessErrorOptions } from '#infra/errors.js';

const definitions = {
  candidate_state_conflict: { category: 'conflict', messageKey: 'ingestionCandidateConflict' },
  candidate_baseline_changed: { category: 'conflict', messageKey: 'ingestionCandidateBaseline' },
  candidate_missing: { category: 'missing', messageKey: 'ingestionCandidateMissing' },
  repair_scope_mismatch: { category: 'invalid', messageKey: 'ingestionRepairScopeMismatch' },
  repair_plan_changed: { category: 'conflict', messageKey: 'ingestionRepairPlanChanged' },
  repair_no_change: { category: 'invalid', messageKey: 'ingestionRepairNoChange' },
  resolution_not_ready: { category: 'conflict', messageKey: 'ingestionResolutionNotReady' },
  resolution_verification_failed: {
    category: 'conflict',
    messageKey: 'ingestionResolutionVerificationFailed',
  },
  resolution_already_handled: {
    category: 'conflict',
    messageKey: 'ingestionResolutionAlreadyHandled',
  },
  export_run_not_found: { category: 'missing', messageKey: 'ingestionExportRunNotFound' },
  export_issue_not_current: { category: 'invalid', messageKey: 'ingestionExportIssueNotCurrent' },
  export_path_is_database: { category: 'invalid', messageKey: 'ingestionExportDatabasePath' },
  export_file_exists: { category: 'conflict', messageKey: 'ingestionExportFileExists' },
  in_progress: { category: 'maintenance', messageKey: 'maintenanceInProgress' },
  invalid_target_date: { category: 'invalid', messageKey: 'ingestionInvalidTargetDate' },
} as const;

export class IngestionError extends BusinessError<keyof typeof definitions> {
  constructor(reason: keyof typeof definitions, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}

/**
 * 临时发布清单无法安全回放。
 *
 * The temporary publication plan cannot be replayed safely.
 */
export class PublicationPlanError extends Error {}
