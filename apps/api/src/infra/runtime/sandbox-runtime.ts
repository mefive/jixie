import type { SandboxBridge } from './sandbox-bridge.js';

interface SandboxInitializationOptions {
  signal?: AbortSignal;
  abortMessage?: string;
}

export abstract class SandboxRuntime<
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

  /** Owns acquired bridges, including those returned after the runtime has already closed. */
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
