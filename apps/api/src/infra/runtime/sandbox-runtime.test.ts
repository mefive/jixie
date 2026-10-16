import { describe, expect, it, vi } from 'vitest';
import { SandboxRuntime } from './sandbox-runtime.js';
import { SandboxBridgeBase } from './sandbox-bridge-base.js';
import type { SandboxBridge, SandboxBridgeInitializationOptions } from './sandbox-bridge.js';

type FixtureBridgeContract = SandboxBridge<number, number, { name: string }>;

class FixtureBridge extends SandboxBridgeBase<number, number, { name: string }> {
  readonly initialize = vi.fn(async (_options?: SandboxBridgeInitializationOptions) => ({
    name: 'fixture',
  }));
  readonly execute = vi.fn(async (input: number) => input * 2);
}

class FixtureRuntime extends SandboxRuntime<number, number, { name: string }> {
  readonly acquire = vi.fn(async (_signal?: AbortSignal) => this.acquiredBridge);

  constructor(private readonly acquiredBridge: FixtureBridgeContract) {
    super();
  }

  start(signal?: AbortSignal, abortMessage?: string): Promise<void> {
    return this.initialize({ signal, abortMessage });
  }

  protected createBridge(signal?: AbortSignal): Promise<FixtureBridgeContract> {
    return this.acquire(signal);
  }
}

function fixture() {
  const transport = {
    send: vi.fn(async () => {}),
    async readValidated<Frame>(): Promise<Frame> {
      throw new Error('Lifecycle fixtures do not read protocol frames');
    },
    close: vi.fn(),
    abort: vi.fn(),
    isClosed: false,
  };

  const bridge = new FixtureBridge(transport);

  return { transport, bridge, runtime: new FixtureRuntime(bridge) };
}

describe('shared sandbox lifecycle', () => {
  it('cleans up a startup failure without replacing the original cause', async () => {
    const { transport, bridge, runtime } = fixture();
    transport.close.mockImplementation(() => {
      throw new Error('cleanup');
    });
    const error = new Error('ready rejected');
    bridge.initialize.mockRejectedValueOnce(error);

    await expect(runtime.start()).rejects.toBe(error);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(runtime.isClosed).toBe(true);
    await expect(runtime.execute(1)).rejects.toThrow('closed');
  });

  it('rejects cancellation after handshake and removes the startup listener', async () => {
    const { transport, bridge, runtime } = fixture();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    bridge.initialize.mockImplementationOnce(async () => {
      controller.abort();

      return { name: 'fixture' };
    });

    await expect(runtime.start(controller.signal)).rejects.toThrow();
    expect(transport.abort).toHaveBeenCalledOnce();
    expect(transport.close).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(runtime.isClosed).toBe(true);
    expect(() => runtime.metadata).toThrow('not ready');
  });

  it('does not acquire a bridge for an already cancelled operation', async () => {
    const { runtime, bridge } = fixture();

    await expect(runtime.start(AbortSignal.abort())).rejects.toThrow();
    expect(runtime.acquire).not.toHaveBeenCalled();
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(runtime.isClosed).toBe(true);
  });

  it('cleans up cancellation during asynchronous bridge acquisition', async () => {
    const { transport, bridge, runtime } = fixture();
    const controller = new AbortController();
    runtime.acquire.mockImplementationOnce(async () => {
      controller.abort();

      return bridge;
    });

    await expect(runtime.start(controller.signal)).rejects.toThrow();
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(transport.abort).toHaveBeenCalledOnce();
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('preserves metadata and supports repeated computations until close', async () => {
    const { transport, bridge, runtime } = fixture();
    const controller = new AbortController();
    await runtime.start(controller.signal);

    expect(runtime.acquire).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(bridge.initialize).toHaveBeenCalledExactlyOnceWith({ signal: controller.signal });
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
    expect(bridge.execute).toHaveBeenCalledTimes(2);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.abort).not.toHaveBeenCalled();
  });

  it('rejects a completed value when the instance was closed during execution', async () => {
    const { runtime, bridge } = fixture();
    await runtime.start();
    bridge.execute.mockImplementation(async () => {
      runtime.close();

      return 3;
    });

    await expect(runtime.execute(1)).rejects.toThrow('closed');
  });

  it('does not discard a reusable namespace after an ordinary execution error', async () => {
    const { runtime, transport, bridge } = fixture();
    await runtime.start();
    bridge.execute.mockRejectedValueOnce(new Error('user callback'));

    await expect(runtime.execute(1)).rejects.toThrow('user callback');
    await expect(runtime.execute(2)).resolves.toBe(4);
    expect(transport.close).not.toHaveBeenCalled();

    runtime.close();
  });

  it('aborts with the original cause and prevents duplicate cleanup', async () => {
    const { transport, runtime } = fixture();
    await runtime.start();
    const error = new Error('cancelled');
    runtime.abort(error);
    runtime.close();
    runtime.abort(new Error('second'));

    expect(runtime.isClosed).toBe(true);
    expect(transport.abort).toHaveBeenCalledExactlyOnceWith(error);
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('rejects execution and metadata access before the handshake completes', async () => {
    const { transport, bridge, runtime } = fixture();
    await expect(runtime.execute(1)).rejects.toThrow('not ready');
    expect(() => runtime.metadata).toThrow('not ready');

    let complete!: (metadata: { name: string }) => void;
    bridge.initialize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const startup = runtime.start();
    await vi.waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    await expect(runtime.execute(1)).rejects.toThrow('not ready');
    expect(() => runtime.metadata).toThrow('not ready');
    expect(bridge.execute).not.toHaveBeenCalled();
    complete({ name: 'fixture' });
    await startup;
    await expect(runtime.execute(1)).resolves.toBe(2);

    runtime.close();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('rejects overlapping and repeated initialization without acquiring another bridge', async () => {
    const { transport, runtime } = fixture();
    const startup = runtime.start();

    await expect(runtime.start()).rejects.toThrow('already started');
    await startup;
    await expect(runtime.start()).rejects.toThrow('already started');
    expect(runtime.acquire).toHaveBeenCalledOnce();
    expect(runtime.isClosed).toBe(false);

    runtime.close();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('closes a bridge acquired after its instance was closed', async () => {
    const { transport, bridge, runtime } = fixture();
    let complete!: (bridge: FixtureBridgeContract) => void;
    runtime.acquire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const startup = runtime.start();
    runtime.close();
    complete(bridge);

    await expect(startup).rejects.toThrow('closed');
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.abort).not.toHaveBeenCalled();
    runtime.close();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('aborts a late bridge with the original cause', async () => {
    const { transport, bridge, runtime } = fixture();
    let complete!: (bridge: FixtureBridgeContract) => void;
    runtime.acquire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const startup = runtime.start();
    const error = new Error('cancelled during acquisition');
    runtime.abort(error);
    complete(bridge);

    await expect(startup).rejects.toThrow('closed');
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(transport.abort).toHaveBeenCalledExactlyOnceWith(error);
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('closes during initialization without publishing metadata or releasing twice', async () => {
    const { transport, bridge, runtime } = fixture();
    bridge.initialize.mockImplementationOnce(async () => {
      runtime.close();

      return { name: 'fixture' };
    });

    await expect(runtime.start()).rejects.toThrow('closed');
    expect(() => runtime.metadata).toThrow('not ready');
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('keeps an acquisition failure terminal without releasing an unowned bridge', async () => {
    const { transport, bridge, runtime } = fixture();
    const error = new Error('connection failed');
    runtime.acquire.mockRejectedValueOnce(error);

    await expect(runtime.start()).rejects.toBe(error);
    expect(runtime.isClosed).toBe(true);
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(transport.close).not.toHaveBeenCalled();
    expect(transport.abort).not.toHaveBeenCalled();
    await expect(runtime.start()).rejects.toThrow('closed');
  });

  it('rejects execution when its transport closes independently after startup', async () => {
    const { transport, bridge, runtime } = fixture();
    await runtime.start();

    transport.isClosed = true;

    expect(runtime.isClosed).toBe(true);
    await expect(runtime.execute(1)).rejects.toThrow('closed');
    expect(bridge.execute).not.toHaveBeenCalled();
    expect(runtime.metadata).toEqual({ name: 'fixture' });

    runtime.close();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.abort).not.toHaveBeenCalled();
  });

  it('rejects a transport that closed before its handshake', async () => {
    const { transport, bridge, runtime } = fixture();
    transport.isClosed = true;

    await expect(runtime.start()).rejects.toThrow('closed');
    expect(bridge.initialize).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
