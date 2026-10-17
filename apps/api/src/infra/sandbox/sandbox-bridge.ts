export interface SandboxBridgeInitializationOptions {
  signal?: AbortSignal;
}

/** Owns a business protocol connection; the runtime controls its business lifecycle. */
export interface SandboxBridge<Input, Output, Metadata, Options = undefined> {
  initialize(options?: SandboxBridgeInitializationOptions): Promise<Metadata>;
  execute(input: Input, options?: Options): Promise<Output>;
  close(): void;
  abort(error: Error): void;
  readonly isClosed: boolean;
}
