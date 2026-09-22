/** Resources expose ownership without coupling the runtime to a language or wire protocol. */
export interface SandboxResource {
  close(): void;
  abort?(error: Error): void;
  readonly isClosed?: boolean;
}

export abstract class SandboxRuntime<Input, Output, Metadata, Options = undefined> {
  private closed = false;

  protected constructor(
    private readonly resource: SandboxResource,
    readonly metadata: Metadata,
  ) {}

  get isClosed(): boolean {
    return this.closed || this.resource.isClosed === true;
  }

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
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.resource.close();
  }

  abort(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.resource.abort) {
      this.resource.abort(error);
    } else {
      this.resource.close();
    }
  }
}

interface SandboxStartup<Resource extends SandboxResource, Runtime> {
  createResource(): Promise<Resource>;
  initialize(resource: Resource): Promise<Runtime>;
  signal?: AbortSignal;
  abortMessage?: string;
}

/** The creator owns partial acquisition; ownership transfers to the instance after initialization. */
export async function startSandboxRuntime<Resource extends SandboxResource, Runtime>(
  options: SandboxStartup<Resource, Runtime>,
): Promise<Runtime> {
  const { signal } = options;
  signal?.throwIfAborted();
  const resource = await options.createResource();
  const abort = () => {
    if (resource.abort) {
      resource.abort(new Error(options.abortMessage ?? 'Sandbox startup aborted'));
    } else {
      resource.close();
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const runtime = await options.initialize(resource);
    signal?.throwIfAborted();
    return runtime;
  } catch (error) {
    try {
      resource.close();
    } catch {
      // Cleanup must preserve the initialization failure.
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
