import type { z } from 'zod';

export interface SandboxFrame {
  type: string;
  [key: string]: unknown;
}

/** Implementations own communication and cleanup; runtimes own their lifecycle. */
export interface SandboxTransport {
  send(frame: SandboxFrame): Promise<void>;
  readValidated<Frame>(schema: z.ZodType<Frame>, operation: string): Promise<Frame>;
  close(): void;
  abort(error: Error): void;
  readonly isClosed: boolean;
}
