import type { z } from 'zod';

/**
 * 约束公共沙盒传输帧的消息形状，供各语言实现复用。
 * Define the frame shape shared by sandbox transport implementations.
 */
export interface SandboxFrame {
  type: string;
  [key: string]: unknown;
}

/**
 * 约束通信和清理能力；传输实现拥有底层资源，宿主决定关闭时机。
 * Implementations own communication and cleanup; runtimes own their lifecycle.
 */
export interface SandboxTransport {
  send(frame: SandboxFrame): Promise<void>;
  readValidated<Frame>(schema: z.ZodType<Frame>, operation: string): Promise<Frame>;
  close(): void;
  abort(error: Error): void;
  readonly isClosed: boolean;
}
