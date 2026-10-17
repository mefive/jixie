import type { SandboxBridge } from './sandbox-bridge.js';

/**
 * 传递沙盒初始化所需的取消选项，供会话启动控制。
 * Configure cancellation for sandbox initialization.
 */
interface SandboxInitializationOptions {
  signal?: AbortSignal;
  abortMessage?: string;
}

export abstract class Sandbox<
  Input,
  Output,
  Metadata,
  Options = undefined,
  Bridge extends SandboxBridge<Input, Output, Metadata, Options> = SandboxBridge<
    Input,
    Output,
    Metadata,
    Options
  >,
> {
  private state: 'new' | 'starting' | 'ready' | 'closed' = 'new';
  private sandboxBridge?: Bridge;
  private initialized?: { metadata: Metadata };
  private abortError?: Error;

  get metadata(): Metadata {
    if (!this.initialized) {
      throw new Error('Sandbox runtime is not ready');
    }

    return this.initialized.metadata;
  }

  get isClosed(): boolean {
    return this.state === 'closed' || this.sandboxBridge?.isClosed === true;
  }

  protected get bridge(): Bridge {
    if (!this.sandboxBridge) {
      throw new Error('Sandbox runtime bridge is unavailable');
    }

    return this.sandboxBridge;
  }

  /**
   * 接管初始化获得的 Bridge，包括关闭后才返回的实例，确保资源被回收。
   * Owns acquired bridges, including those returned after the sandbox has already closed.
   */
  protected async initialize(options: SandboxInitializationOptions = {}): Promise<void> {
    if (this.isClosed) {
      throw new Error('Sandbox runtime is closed');
    }
    if (this.state !== 'new') {
      throw new Error('Sandbox runtime initialization has already started');
    }
    this.state = 'starting';

    const { signal } = options;
    const abort = () => this.abort(new Error(options.abortMessage ?? 'Sandbox startup aborted'));
    signal?.addEventListener('abort', abort, { once: true });

    try {
      signal?.throwIfAborted();
      this.sandboxBridge = await this.createBridge(signal);

      signal?.throwIfAborted();
      if (this.isClosed) {
        throw new Error('Sandbox runtime is closed');
      }
      const metadata = await this.bridge.initialize({ signal });

      signal?.throwIfAborted();
      if (this.isClosed) {
        throw new Error('Sandbox runtime is closed');
      }
      this.initialized = { metadata };
      this.state = 'ready';
    } catch (error) {
      this.state = 'closed';
      try {
        this.releaseBridge(this.abortError);
      } catch {
        // Cleanup must preserve the initialization failure.
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  protected abstract createBridge(signal?: AbortSignal): Promise<Bridge>;

  async execute(input: Input, options?: Options): Promise<Output> {
    this.assertOpen();
    const result = await this.executeInSandbox(input, options);
    this.assertOpen();

    return result;
  }

  protected executeInSandbox(input: Input, options?: Options): Promise<Output> {
    return this.bridge.execute(input, options);
  }

  protected assertOpen(): void {
    if (this.isClosed) {
      throw new Error('Sandbox runtime is closed');
    }
    if (this.state !== 'ready') {
      throw new Error('Sandbox runtime is not ready');
    }
  }

  close(): void {
    if (this.state === 'closed') {
      return;
    }
    this.state = 'closed';
    this.releaseBridge();
  }

  abort(error: Error): void {
    if (this.state === 'closed') {
      return;
    }
    this.state = 'closed';
    this.abortError = error;
    this.releaseBridge(error);
  }

  /**
   * 按关闭或终止原因释放已取得 Bridge，并清理沙盒引用。
   * Release an acquired bridge under close or abort semantics.
   */
  private releaseBridge(error?: Error): void {
    const bridge = this.sandboxBridge;
    this.sandboxBridge = undefined;
    if (!bridge) {
      return;
    }

    if (error) {
      bridge.abort(error);
    } else {
      bridge.close();
    }
  }
}
