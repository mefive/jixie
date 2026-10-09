import { describe, expect, it, vi } from 'vitest';
import { SandboxRuntime, type SandboxResource } from './sandbox-runtime.js';

class FixtureRuntime extends SandboxRuntime<number, number, { name: string }> {
  readonly acquire = vi.fn(async (_signal?: AbortSignal) => this.acquiredResource);
  readonly initializeSandbox = vi.fn(async (_resource: SandboxResource, _signal?: AbortSignal) => ({
    name: 'fixture',
  }));
  readonly compute = vi.fn(async (input: number) => input * 2);

  constructor(private readonly acquiredResource: SandboxResource) {
    super();
  }

  start(signal?: AbortSignal, abortMessage?: string): Promise<void> {
    return this.initialize({ signal, abortMessage });
  }

  protected createResource(signal?: AbortSignal): Promise<SandboxResource> {
    return this.acquire(signal);
  }

  protected initializeInSandbox(resource: SandboxResource, signal?: AbortSignal) {
    return this.initializeSandbox(resource, signal);
  }

  protected executeInSandbox(input: number): Promise<number> {
    return this.compute(input);
  }
}

function fixture() {
  const resource = { close: vi.fn(), abort: vi.fn() };

  return { resource, runtime: new FixtureRuntime(resource) };
}

describe('shared sandbox lifecycle', () => {
  it('cleans up a startup failure without replacing the original cause', async () => {
    const { resource, runtime } = fixture();
    resource.close.mockImplementation(() => {
      throw new Error('cleanup');
    });
    const error = new Error('ready rejected');
    runtime.initializeSandbox.mockRejectedValueOnce(error);

    await expect(runtime.start()).rejects.toBe(error);
    expect(resource.close).toHaveBeenCalledOnce();
    expect(runtime.isClosed).toBe(true);
    await expect(runtime.execute(1)).rejects.toThrow('closed');
  });

  it('rejects cancellation after handshake and removes the startup listener', async () => {
    const { resource, runtime } = fixture();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    runtime.initializeSandbox.mockImplementationOnce(async () => {
      controller.abort();

      return { name: 'fixture' };
    });

    await expect(runtime.start(controller.signal)).rejects.toThrow();
    expect(resource.abort).toHaveBeenCalledOnce();
    expect(resource.close).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(runtime.isClosed).toBe(true);
    expect(() => runtime.metadata).toThrow('not ready');
  });

  it('does not acquire a resource for an already cancelled operation', async () => {
    const { runtime } = fixture();

    await expect(runtime.start(AbortSignal.abort())).rejects.toThrow();
    expect(runtime.acquire).not.toHaveBeenCalled();
    expect(runtime.initializeSandbox).not.toHaveBeenCalled();
    expect(runtime.isClosed).toBe(true);
  });

  it('cleans up cancellation during asynchronous resource acquisition', async () => {
    const { resource, runtime } = fixture();
    const controller = new AbortController();
    runtime.acquire.mockImplementationOnce(async () => {
      controller.abort();

      return resource;
    });

    await expect(runtime.start(controller.signal)).rejects.toThrow();
    expect(runtime.initializeSandbox).not.toHaveBeenCalled();
    expect(resource.abort).toHaveBeenCalledOnce();
    expect(resource.close).not.toHaveBeenCalled();
  });

  it('preserves metadata and supports repeated computations until close', async () => {
    const { resource, runtime } = fixture();
    const controller = new AbortController();
    await runtime.start(controller.signal);

    expect(runtime.acquire).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(runtime.initializeSandbox).toHaveBeenCalledExactlyOnceWith(resource, controller.signal);
    expect(runtime.metadata).toEqual({ name: 'fixture' });
    await expect(runtime.execute(4)).resolves.toBe(8);
    await expect(runtime.execute(5)).resolves.toBe(10);

    controller.abort();
    expect(runtime.isClosed).toBe(false);
    runtime.close();
    runtime.close();
    runtime.abort(new Error('late'));
    await expect(runtime.execute(6)).rejects.toThrow('closed');
    expect(runtime.metadata).toEqual({ name: 'fixture' });
    expect(runtime.compute).toHaveBeenCalledTimes(2);
    expect(resource.close).toHaveBeenCalledOnce();
    expect(resource.abort).not.toHaveBeenCalled();
  });

  it('rejects a completed value when the instance was closed during execution', async () => {
    const { runtime } = fixture();
    await runtime.start();
    runtime.compute.mockImplementation(async () => {
      runtime.close();

      return 3;
    });

    await expect(runtime.execute(1)).rejects.toThrow('closed');
  });

  it('does not discard a reusable namespace after an ordinary execution error', async () => {
    const { runtime, resource } = fixture();
    await runtime.start();
    runtime.compute.mockRejectedValueOnce(new Error('user callback'));

    await expect(runtime.execute(1)).rejects.toThrow('user callback');
    await expect(runtime.execute(2)).resolves.toBe(4);
    expect(resource.close).not.toHaveBeenCalled();

    runtime.close();
  });

  it('aborts with the original cause and prevents duplicate cleanup', async () => {
    const { resource, runtime } = fixture();
    await runtime.start();
    const error = new Error('cancelled');
    runtime.abort(error);
    runtime.close();
    runtime.abort(new Error('second'));

    expect(runtime.isClosed).toBe(true);
    expect(resource.abort).toHaveBeenCalledExactlyOnceWith(error);
    expect(resource.close).not.toHaveBeenCalled();
  });

  it('rejects execution and metadata access before the handshake completes', async () => {
    const { resource, runtime } = fixture();
    await expect(runtime.execute(1)).rejects.toThrow('not ready');
    expect(() => runtime.metadata).toThrow('not ready');

    let complete!: (metadata: { name: string }) => void;
    runtime.initializeSandbox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const startup = runtime.start();
    await vi.waitFor(() => expect(runtime.initializeSandbox).toHaveBeenCalledOnce());

    await expect(runtime.execute(1)).rejects.toThrow('not ready');
    expect(() => runtime.metadata).toThrow('not ready');
    expect(runtime.compute).not.toHaveBeenCalled();
    complete({ name: 'fixture' });
    await startup;
    await expect(runtime.execute(1)).resolves.toBe(2);

    runtime.close();
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('rejects overlapping and repeated initialization without acquiring another resource', async () => {
    const { resource, runtime } = fixture();
    const startup = runtime.start();

    await expect(runtime.start()).rejects.toThrow('already started');
    await startup;
    await expect(runtime.start()).rejects.toThrow('already started');
    expect(runtime.acquire).toHaveBeenCalledOnce();
    expect(runtime.isClosed).toBe(false);

    runtime.close();
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('closes a resource acquired after its instance was closed', async () => {
    const { resource, runtime } = fixture();
    let complete!: (resource: SandboxResource) => void;
    runtime.acquire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const startup = runtime.start();
    runtime.close();
    complete(resource);

    await expect(startup).rejects.toThrow('closed');
    expect(runtime.initializeSandbox).not.toHaveBeenCalled();
    expect(resource.close).toHaveBeenCalledOnce();
    expect(resource.abort).not.toHaveBeenCalled();
    runtime.close();
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('aborts a late resource with the original cause', async () => {
    const { resource, runtime } = fixture();
    let complete!: (resource: SandboxResource) => void;
    runtime.acquire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const startup = runtime.start();
    const error = new Error('cancelled during acquisition');
    runtime.abort(error);
    complete(resource);

    await expect(startup).rejects.toThrow('closed');
    expect(runtime.initializeSandbox).not.toHaveBeenCalled();
    expect(resource.abort).toHaveBeenCalledExactlyOnceWith(error);
    expect(resource.close).not.toHaveBeenCalled();
  });

  it('closes during initialization without publishing metadata or releasing twice', async () => {
    const { resource, runtime } = fixture();
    runtime.initializeSandbox.mockImplementationOnce(async () => {
      runtime.close();

      return { name: 'fixture' };
    });

    await expect(runtime.start()).rejects.toThrow('closed');
    expect(() => runtime.metadata).toThrow('not ready');
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('keeps an acquisition failure terminal without releasing an unowned resource', async () => {
    const { resource, runtime } = fixture();
    const error = new Error('connection failed');
    runtime.acquire.mockRejectedValueOnce(error);

    await expect(runtime.start()).rejects.toBe(error);
    expect(runtime.isClosed).toBe(true);
    expect(runtime.initializeSandbox).not.toHaveBeenCalled();
    expect(resource.close).not.toHaveBeenCalled();
    expect(resource.abort).not.toHaveBeenCalled();
    await expect(runtime.start()).rejects.toThrow('closed');
  });

  it('falls back to close when the resource has no abort method', async () => {
    const resource = { close: vi.fn() };
    const runtime = new FixtureRuntime(resource);
    await runtime.start();

    runtime.abort(new Error('cancelled'));
    runtime.close();
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('rejects a resource that closed before its handshake', async () => {
    const resource = { close: vi.fn(), isClosed: true };
    const runtime = new FixtureRuntime(resource);

    await expect(runtime.start()).rejects.toThrow('closed');
    expect(runtime.initializeSandbox).not.toHaveBeenCalled();
    expect(resource.close).toHaveBeenCalledOnce();
  });
});
