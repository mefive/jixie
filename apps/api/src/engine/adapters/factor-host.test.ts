import { describe, expect, it } from 'vitest';
import type { FactorBar } from '@jixie/shared';
import type { CustomFactorModule } from '../factors/custom-factor.js';
import type { FactorComputeRequest } from '../factors/execution-port.js';
import { FactorHost } from './factor-host.js';

const bar: FactorBar = {
  code: 'A',
  pe: null,
  peTtm: 10,
  pb: null,
  ps: null,
  psTtm: null,
  dvRatio: null,
  dvTtm: null,
  totalMv: null,
  circMv: null,
  turnoverRate: null,
  netMain: null,
  netTotal: null,
  roe: null,
  roa: null,
  grossprofitMargin: null,
  debtToAssets: null,
};
const module: CustomFactorModule = {
  key: 'value',
  js: 'module.exports = defineFactor({ name: "value", compute: (bar) => bar.peTtm * 2 });',
};
const request: FactorComputeRequest = {
  factorId: 'value',
  kind: 'cross_sectional',
  items: [{ bar }],
};

describe('FactorHost', () => {
  it('keeps source frozen and rejects source injection and unregistered dependencies', async () => {
    const dependency = { ...module };
    const host = new FactorHost([dependency]);
    dependency.js = 'throw new Error("replaced")';
    try {
      const definitions = await host.describe();
      definitions[0].id = 'changed';
      expect((await host.describe())[0].id).toBe('value');
      expect(await host.compute(request)).toEqual([20]);
      await expect(host.compute({ ...request, factorId: 'foreign' })).rejects.toThrow(
        'Unknown factor dependency',
      );
      await expect(
        host.compute({ ...request, code: 'arbitrary' } as FactorComputeRequest),
      ).rejects.toThrow();
      await expect(
        host.compute({ ...request, items: [{ bar: { ...bar, peTtm: Infinity } }] }),
      ).rejects.toThrow();
    } finally {
      host.close();
    }
    await expect(host.describe()).rejects.toThrow('closed');
    await expect(host.compute(request)).rejects.toThrow('closed');
  });

  it('runs initialization and computation without Node globals or the caller global object', async () => {
    const host = new FactorHost([
      {
        key: 'value',
        js: `
        if (typeof process !== 'undefined') throw new Error('host initialization');
        globalThis.__factorIsolationProbe = 42;
        module.exports = defineFactor({ name: 'isolation', compute() {
          if (typeof process !== 'undefined' || typeof require !== 'undefined' && (() => {
            try { require('node:fs'); return true; } catch { return false; }
          })()) throw new Error('host computation');
          return Function('return typeof process')() === 'undefined' ? 42 : -1;
        } });
      `,
      },
    ]);
    try {
      expect(await host.compute(request)).toEqual([42]);
      expect((globalThis as Record<string, unknown>).__factorIsolationProbe).toBeUndefined();
    } finally {
      host.close();
    }
  });

  it('serializes batches in a runtime and keeps different runs independent', async () => {
    const stateful = {
      key: 'value',
      js: `let count = 0;
      module.exports = defineFactor({ name: 'counter', compute() { return ++count; } });`,
    };
    const host = new FactorHost([stateful]);
    const another = new FactorHost([stateful]);
    try {
      expect(await Promise.all([host.compute(request), host.compute(request)])).toEqual([[1], [2]]);
      expect(await another.compute(request)).toEqual([1]);
    } finally {
      host.close();
      another.close();
    }
  });

  it('closes successful initializations if a later dependency fails', async () => {
    const host = new FactorHost([
      module,
      { key: 'broken', js: 'throw new Error("broken dependency")' },
    ]);
    await expect(host.describe()).rejects.toThrow('broken dependency');
    await expect(host.compute(request)).rejects.toThrow('closed');
    host.close();
  });

  it('disposes a runtime whose asynchronous initialization finishes after close', async () => {
    const host = new FactorHost([module]);
    const initializing = host.describe();
    host.close();
    await expect(initializing).rejects.toThrow('closed');
    await expect(host.describe()).rejects.toThrow('closed');
  });

  it('rejects duplicate dependencies and mismatched frozen metadata', async () => {
    const duplicate = new FactorHost([module, module]);
    const mismatched = new FactorHost([{ ...module, crossSectional: { window: 3 } }]);
    try {
      await expect(duplicate.describe()).rejects.toThrow('Duplicate factor dependency');
      await expect(mismatched.describe()).rejects.toThrow('compiled cross-sectional contract');
    } finally {
      duplicate.close();
      mismatched.close();
    }
  });
});
