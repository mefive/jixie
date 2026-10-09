/** Resources expose ownership without coupling the runtime to a language or wire protocol. */
export interface SandboxResource {
  close(): void;
  abort?(error: Error): void;
  readonly isClosed?: boolean;
}

interface SandboxInitializationOptions {
  signal?: AbortSignal;
  abortMessage?: string;
}

export abstract class SandboxRuntime<
  Input,
  Output,
  Metadata,
  Resource extends SandboxResource = SandboxResource,
  Options = undefined,
> {
  private state: 'new' | 'starting' | 'ready' | 'closed' = 'new';
  private sandboxResource?: Resource;
  private initialized?: { metadata: Metadata };
  private abortError?: Error;

  get metadata(): Metadata {
    if (!this.initialized) {
      throw new Error('Sandbox runtime is not ready');
    }

    return this.initialized.metadata;
  }

  get isClosed(): boolean {
    return this.state === 'closed' || this.sandboxResource?.isClosed === true;
  }

  protected get resource(): Resource {
    if (!this.sandboxResource) {
      throw new Error('Sandbox runtime resource is unavailable');
    }

    return this.sandboxResource;
  }

  /** The instance owns resources returned by createResource, including late acquisition after close. */
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
      this.sandboxResource = await this.createResource(signal);

      signal?.throwIfAborted();
      if (this.isClosed) {
        throw new Error('Sandbox runtime is closed');
      }
      const metadata = await this.initializeInSandbox(this.resource, signal);

      signal?.throwIfAborted();
      if (this.isClosed) {
        throw new Error('Sandbox runtime is closed');
      }
      this.initialized = { metadata };
      this.state = 'ready';
    } catch (error) {
      this.state = 'closed';
      try {
        this.releaseResource(this.abortError);
      } catch {
        // Cleanup must preserve the initialization failure.
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  protected abstract createResource(signal?: AbortSignal): Promise<Resource>;

  protected abstract initializeInSandbox(
    resource: Resource,
    signal?: AbortSignal,
  ): Promise<Metadata>;

  async execute(input: Input, options?: Options): Promise<Output> {
    this.assertOpen();
    const result = await this.executeInSandbox(input, options);
    this.assertOpen();

    return result;
  }

  protected abstract executeInSandbox(input: Input, options?: Options): Promise<Output>;

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
    this.releaseResource();
  }

  abort(error: Error): void {
    if (this.state === 'closed') {
      return;
    }
    this.state = 'closed';
    this.abortError = error;
    this.releaseResource(error);
  }

  private releaseResource(error?: Error): void {
    const resource = this.sandboxResource;
    this.sandboxResource = undefined;
    if (!resource) {
      return;
    }

    if (error && resource.abort) {
      resource.abort(error);
    } else {
      resource.close();
    }
  }
}
