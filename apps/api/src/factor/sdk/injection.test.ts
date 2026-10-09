import { describe, expect, it, vi } from 'vitest';
import { AssetFactorContext, CrossSectionalFactorContext } from './typescript.js';
import type { AssetFactorCapabilities, CrossSectionalFactorCapabilities } from './capabilities.js';

describe('Factor SDK capability injection', () => {
  it('reads history from an injected capability and keeps returned arrays independent', () => {
    const values = [10, 11, 12];
    const capabilities: CrossSectionalFactorCapabilities = {
      hasHistory: true,
      historyValues: (field) => (field === 'date' ? ['1', '2', '3'] : values),
    };
    const { history } = new CrossSectionalFactorContext(capabilities);
    const result = history(2);
    result[0] = -1;

    expect(values).toEqual([10, 11, 12]);
    expect(history(2)).toEqual([11, 12]);
    expect(history(2, 'date')).toEqual(['2', '3']);
    expect(history(4)).toEqual([]);
    expect(history(0)).toEqual([]);
  });

  it('rejects unavailable history before accessing its data', () => {
    const historyValues = vi.fn(() => []);
    const context = new CrossSectionalFactorContext({ hasHistory: false, historyValues });
    expect(() => context.history(1)).toThrow('window');
    expect(historyValues).not.toHaveBeenCalled();
  });

  it('validates declarations and offsets before reading values, including detached methods', () => {
    const valueAt = vi.fn((_field: string, periods: number) => (periods === 0 ? 12 : 10));
    const capabilities: AssetFactorCapabilities = {
      declaresInput: (field) => field === 'etf.adjustedClose',
      valueAt,
    };
    const { value, lag } = new AssetFactorContext(capabilities);
    expect(value('etf.adjustedClose')).toBe(12);
    expect(lag('etf.adjustedClose', 1)).toBe(10);
    valueAt.mockClear();

    expect(() => lag('etf.adjustedClose', -1)).toThrow('non-negative integer');
    expect(() => value('rates.cgb.yield.2y')).toThrow('undeclared input');
    expect(valueAt).not.toHaveBeenCalled();
  });
});
