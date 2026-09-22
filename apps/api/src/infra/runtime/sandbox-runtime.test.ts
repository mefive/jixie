import { describe, expect, it, vi } from 'vitest';
import { SandboxRuntime, startSandboxRuntime, type SandboxResource } from './sandbox-runtime.js';

class FixtureRuntime extends SandboxRuntime<number, number, { name: string }> {
  readonly compute = vi.fn(async (input: number) => input * 2);
  constructor(resource: SandboxResource) {
    super(resource, { name: 'fixture' });
  }
  protected executeInSandbox(input: number): Promise<number> {
    return this.compute(input);
  }
}

function fixture() {
  const resource = { close: vi.fn(), abort: vi.fn() };
  return {
    resource,
    runtime: new FixtureRuntime(resource),
    createResource: vi.fn(async () => resource),
  };
}

describe('shared sandbox lifecycle', () => {
  it('cleans up a startup failure without replacing the original cause', async () => {
    const { resource, createResource } = fixture();
    resource.close.mockImplementation(() => {
      throw new Error('cleanup');
    });
    const error = new Error('ready rejected');
    await expect(
      startSandboxRuntime({
        createResource,
        initialize: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('rejects cancellation after ready and removes the startup listener', async () => {
    const { resource, runtime, createResource } = fixture();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(
      startSandboxRuntime({
        createResource,
        initialize: async () => {
          controller.abort();
          return runtime;
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(resource.abort).toHaveBeenCalledOnce();
    expect(resource.close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not acquire a resource for an already cancelled operation', async () => {
    const { createResource } = fixture();
    await expect(
      startSandboxRuntime({ createResource, initialize: vi.fn(), signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(createResource).not.toHaveBeenCalled();
  });

  it('cleans up cancellation during asynchronous resource acquisition', async () => {
    const { resource } = fixture();
    const controller = new AbortController();
    const initialize = vi.fn();
    await expect(
      startSandboxRuntime({
        createResource: async () => {
          controller.abort();
          return resource;
        },
        initialize,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(initialize).not.toHaveBeenCalled();
    expect(resource.close).toHaveBeenCalledOnce();
  });

  it('preserves metadata and supports repeated computations until close', async () => {
    const { resource, runtime } = fixture();
    expect(runtime.metadata).toEqual({ name: 'fixture' });
    await expect(runtime.execute(4)).resolves.toBe(8);
    await expect(runtime.execute(5)).resolves.toBe(10);
    runtime.close();
    runtime.close();
    runtime.abort(new Error('late'));
    await expect(runtime.execute(6)).rejects.toThrow('closed');
    expect(runtime.compute).toHaveBeenCalledTimes(2);
    expect(resource.close).toHaveBeenCalledOnce();
    expect(resource.abort).not.toHaveBeenCalled();
  });

  it('rejects a completed value when the instance was closed during execution', async () => {
    const { runtime } = fixture();
    runtime.compute.mockImplementation(async () => {
      runtime.close();
      return 3;
    });
    await expect(runtime.execute(1)).rejects.toThrow('closed');
  });

  it('does not discard a reusable namespace after an ordinary execution error', async () => {
    const { runtime, resource } = fixture();
    runtime.compute.mockRejectedValueOnce(new Error('user callback'));
    await expect(runtime.execute(1)).rejects.toThrow('user callback');
    await expect(runtime.execute(2)).resolves.toBe(4);
    expect(resource.close).not.toHaveBeenCalled();
  });

  it('aborts with the original cause and prevents duplicate cleanup', () => {
    const { resource, runtime } = fixture();
    const error = new Error('cancelled');
    runtime.abort(error);
    runtime.close();
    runtime.abort(new Error('second'));
    expect(runtime.isClosed).toBe(true);
    expect(resource.abort).toHaveBeenCalledExactlyOnceWith(error);
    expect(resource.close).not.toHaveBeenCalled();
  });
});
