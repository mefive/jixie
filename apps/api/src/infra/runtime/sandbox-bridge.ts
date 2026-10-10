export interface SandboxBridgeInitializationOptions {
  signal?: AbortSignal;
}

/** Business protocol boundary; the runtime owns resources and lifecycle state. */
export interface SandboxBridge<Input, Output, Metadata, Options = undefined> {
  initialize(options?: SandboxBridgeInitializationOptions): Promise<Metadata>;
  execute(input: Input, options?: Options): Promise<Output>;
}
