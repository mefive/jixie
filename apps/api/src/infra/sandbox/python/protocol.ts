import { z } from 'zod';

export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/**
 * 定义 Python 沙盒通信帧，供宿主会话进行消息封装。
 *
 * Describe Python sandbox frames exchanged through the host session.
 */
export interface PythonFrame {
  type: string;
  [key: string]: unknown;
}

export const pythonFrameEnvelopeSchema = z
  .object({ type: z.string().min(1).max(64) })
  .catchall(z.unknown());
