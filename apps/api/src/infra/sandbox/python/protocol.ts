import { z } from 'zod';

export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface PythonFrame {
  type: string;
  [key: string]: unknown;
}

export const pythonFrameEnvelopeSchema = z
  .object({ type: z.string().min(1).max(64) })
  .catchall(z.unknown());
