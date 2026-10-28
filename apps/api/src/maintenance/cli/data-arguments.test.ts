import { describe, expect, it } from 'vitest';
import { parseDataArguments } from './data.js';

describe('data list CLI arguments', () => {
  it('parses list, selection and edits without importing business modules', () => {
    expect(parseDataArguments(['etf', 'select-top'])).toEqual({
      action: 'select-top',
      assetType: 'etf',
      limit: 100,
    });
    expect(parseDataArguments(['etf', 'select-top', '--limit', '20'])).toMatchObject({ limit: 20 });
    expect(parseDataArguments(['etf', 'list'])).toEqual({ action: 'list', assetType: 'etf' });
    expect(parseDataArguments(['index', 'add', 'H00300.CSI'])).toEqual({
      action: 'add',
      assetType: 'index',
      code: 'H00300.CSI',
    });
    expect(parseDataArguments(['index', 'remove', '000300.SH'])).toMatchObject({
      action: 'remove',
    });
  });
  it.each([
    ['etf', 'select-top', '--limit', '0'],
    ['etf', 'select-top', '--limit', '2.5'],
    ['index', 'select-top'],
    ['etf', 'add', 'invalid'],
    ['index', 'add', 'HSI.HI'],
    ['etf', 'list', 'extra'],
  ])('rejects invalid arguments %j', (...args) => {
    expect(() => parseDataArguments(args)).toThrow('Usage:');
  });
});
