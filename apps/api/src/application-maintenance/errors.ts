import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  in_progress: {
    category: 'maintenance',
    messageKey: 'maintenanceInProgress',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type MaintenanceErrorReason = keyof typeof definitions;

export class MaintenanceError extends BusinessError<MaintenanceErrorReason> {
  constructor(reason: MaintenanceErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
