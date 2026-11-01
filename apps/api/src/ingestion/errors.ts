import { BusinessError, type BusinessErrorOptions } from '#infra/errors.js';

const definitions = {
  in_progress: { category: 'maintenance', messageKey: 'maintenanceInProgress' },
  invalid_target_date: { category: 'invalid', messageKey: 'ingestionInvalidTargetDate' },
} as const;

export class IngestionError extends BusinessError<keyof typeof definitions> {
  constructor(reason: keyof typeof definitions, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
