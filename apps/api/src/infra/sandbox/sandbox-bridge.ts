/**
 * 传递 Bridge 握手的取消信号，供初始化失败时统一清理。
 * Supply cancellation options for bridge initialization and cleanup.
 */
export interface SandboxBridgeInitializationOptions {
  signal?: AbortSignal;
}

/**
 * 约束业务协议连接能力，业务生命周期由其宿主运行实例控制。
 * Owns a business protocol connection; the runtime controls its business lifecycle.
 */
export interface SandboxBridge<Input, Output, Metadata, Options = undefined> {
  initialize(options?: SandboxBridgeInitializationOptions): Promise<Metadata>;
  execute(input: Input, options?: Options): Promise<Output>;
  close(): void;
  abort(error: Error): void;
  readonly isClosed: boolean;
}
