import { researchRuntimePool } from '../pool.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PythonSession } from '#infra/runtime/python/session.js';

const documentId = 'capability-test';
function sessionFixture(capabilities?: string[]) {
  const environment = { runtime: 'research-py-v1', python: 'fixture' };
  const session = {
    send: vi.fn().mockResolvedValue(undefined),
    readValidated: vi
      .fn()
      .mockResolvedValueOnce({
        type: 'research_ready',
        environment,
        ...(capabilities ? { capabilities } : {}),
      })
      .mockResolvedValueOnce({
        type: 'research_executed',
        outputs: [{ type: 'value', value: 1 }],
        definitions: [],
        references: [],
      }),
    close: vi.fn(),
    abort: vi.fn(),
  };
  vi.spyOn(PythonSession, 'connect').mockResolvedValue(session as unknown as PythonSession);
  return session;
}

afterEach(() => {
  researchRuntimePool.close(documentId);
  vi.restoreAllMocks();
});

describe('Research runtime parameter capability negotiation', () => {
  it('keeps ordinary Cells compatible with a sandbox that has no parameter capability', async () => {
    sessionFixture();
    expect(
      (
        await researchRuntimePool.withRuntime(documentId, (runtime) =>
          runtime.execute({ cell: { id: 'cell', source: '1' } }),
        )
      ).outputs,
    ).toEqual([{ type: 'value', value: 1 }]);
  });

  it('rejects embedded execution before sending source if the sandbox would ignore its parameters', async () => {
    const session = sessionFixture();
    await expect(
      researchRuntimePool.withRuntime(documentId, (runtime) =>
        runtime.execute(
          { cell: { id: 'cell', source: 'parameters["window"]' }, parameters: { window: 12 } },
          {},
        ),
      ),
    ).rejects.toThrow('sandbox must be updated');
    expect(session.send.mock.calls.some(([frame]) => frame.type === 'research_execute')).toBe(
      false,
    );
    expect(session.close).toHaveBeenCalled();
  });

  it('sends explicit parameters without rewriting Python source and records the capability in the environment', async () => {
    const session = sessionFixture(['explicit_parameters']);
    const source = 'from __future__ import annotations\nparameters["window"]';
    const parameters = { window: 12, enabled: true, absent: null };
    const captureEnvironment = vi.fn();
    await researchRuntimePool.withRuntime(documentId, (runtime) =>
      runtime.execute(
        { cell: { id: 'cell', source }, parameters: parameters },
        { captureEnvironment },
      ),
    );
    expect(session.send).toHaveBeenCalledWith({
      type: 'research_execute',
      cell_id: 'cell',
      source,
      parameters,
    });
    expect(captureEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: ['explicit_parameters'] }),
    );
  });
});
