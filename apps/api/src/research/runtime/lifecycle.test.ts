import { researchRuntimePool } from './pool.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PythonSession } from '#infra/runtime/python/session.js';

const documentId = 'runtime-lifecycle';
const executed = { type: 'research_executed', outputs: [], definitions: [], references: [] };
function fixture() {
  const session = {
    send: vi.fn().mockResolvedValue(undefined),
    readValidated: vi
      .fn()
      .mockResolvedValueOnce({ type: 'research_ready', environment: {}, capabilities: [] })
      .mockResolvedValue(executed),
    close: vi.fn(),
    abort: vi.fn(),
  };
  vi.spyOn(PythonSession, 'connect').mockResolvedValue(session as unknown as PythonSession);
  return session;
}
const cell = { id: 'cell', source: '1' };
afterEach(() => {
  researchRuntimePool.close(documentId);
  vi.restoreAllMocks();
});

describe('Research pool and instance ownership', () => {
  it('does not create a runtime when resetting an unused document', async () => {
    const session = fixture();
    await researchRuntimePool.reset(documentId);
    expect(PythonSession.connect).not.toHaveBeenCalled();
    expect(session.send).not.toHaveBeenCalled();
  });

  it('retains the instance for Python errors but replaces it for protocol errors', async () => {
    const session = fixture();
    session.readValidated.mockResolvedValueOnce({
      type: 'research_error',
      message: 'user failure',
      definitions: [],
      references: [],
    });
    await expect(
      researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell })),
    ).rejects.toThrow('user failure');
    await researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell }));
    expect(PythonSession.connect).toHaveBeenCalledOnce();
    session.readValidated.mockRejectedValueOnce(new Error('invalid protocol'));
    await expect(
      researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell })),
    ).rejects.toThrow('invalid protocol');
    expect(session.close).toHaveBeenCalledOnce();
    fixture();
    await researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell }));
  });

  it('does not reuse an instance closed by the log transfer limit', async () => {
    const session = fixture();
    session.readValidated.mockResolvedValueOnce({
      type: 'log',
      text: 'x'.repeat(8 * 1024 * 1024),
      level: 'info',
    });
    await expect(
      researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell })),
    ).rejects.toThrow('log output');
    expect(session.close).toHaveBeenCalledOnce();
    const replacement = fixture();
    await researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell }));
    expect(replacement.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'research_start' }),
    );
  });

  it('queues operations behind the active cell without adding a second runtime queue', async () => {
    const session = fixture();
    let complete!: (value: typeof executed) => void;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    session.readValidated.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const first = researchRuntimePool.withRuntime(documentId, (runtime) =>
      runtime.execute({ cell: { ...cell, id: 'first' } }),
    );
    await reading;
    const second = researchRuntimePool.withRuntime(documentId, (runtime) =>
      runtime.execute({ cell: { ...cell, id: 'second' } }),
    );
    expect(
      session.send.mock.calls.filter(([frame]) => frame.type === 'research_execute'),
    ).toHaveLength(1);
    complete(executed);
    await Promise.all([first, second]);
    expect(PythonSession.connect).toHaveBeenCalledOnce();
    expect(
      session.send.mock.calls
        .filter(([frame]) => frame.type === 'research_execute')
        .map(([frame]) => frame.cell_id),
    ).toEqual(['first', 'second']);
  });

  it('cancels queued work, drains pending operations and permits a fresh instance', async () => {
    const session = fixture();
    let entered!: () => void;
    let rejectRead!: (error: Error) => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    session.readValidated.mockImplementationOnce(() => {
      entered();
      return new Promise((_resolve, reject) => {
        rejectRead = reject;
      });
    });
    session.abort.mockImplementation((error: Error) => rejectRead(error));
    const first = researchRuntimePool.withRuntime(documentId, (runtime) =>
      runtime.execute({ cell: cell }),
    );
    const firstFailure = expect(first).rejects.toThrow('aborted');
    await reading;
    const controller = new AbortController();
    let listening!: () => void;
    const listenerInstalled = new Promise<void>((resolve) => {
      listening = resolve;
    });
    const addListener = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
      addListener(...args);
      listening();
    });
    const second = researchRuntimePool.withRuntime(
      documentId,
      (runtime) =>
        runtime.execute({ cell: { ...cell, id: 'queued' } }, { signal: controller.signal }),
      { signal: controller.signal },
    );
    const secondFailure = expect(second).rejects.toThrow();
    // Wait for the queued operation to install its abort listener.
    await listenerInstalled;
    controller.abort();
    await Promise.all([firstFailure, secondFailure]);
    expect(session.send.mock.calls.some(([frame]) => frame.cell_id === 'queued')).toBe(false);
    const replacement = fixture();
    await researchRuntimePool.withRuntime(documentId, (runtime) => runtime.execute({ cell: cell }));
    expect(replacement.close).not.toHaveBeenCalled();
  });
});
