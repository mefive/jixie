import type { z } from 'zod';
import type { submitSignalRunBodySchema } from '@jixie/shared/api/signals';

export type SubmitSignalRunInput = z.output<typeof submitSignalRunBodySchema> & {
  deploymentId: string;
};
