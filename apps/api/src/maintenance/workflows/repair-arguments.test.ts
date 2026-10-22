import { describe, expect, it } from 'vitest';
import { parseRepairArguments } from './repair-arguments.js';

describe('repair arguments', () => {
  it('accepts the default range or an explicit pair of dates', () => {
    expect(parseRepairArguments([])).toEqual({ startDate: undefined, endDate: undefined });
    expect(parseRepairArguments(['20260910', '20260910'])).toEqual({
      startDate: '20260910',
      endDate: '20260910',
    });
  });

  it('explains how to update a legacy refresh command', () => {
    expect(() => parseRepairArguments(['20260910', '20260910', '--refresh'])).toThrow(
      'remove --refresh',
    );
  });

  it.each([
    ['20260910'],
    ['20260911', '20260910'],
    ['20260910', '--force'],
    ['20260910', '20260910', '20260911'],
  ])('rejects invalid arguments %j', (...args) => {
    expect(() => parseRepairArguments(args)).toThrow('Usage:');
  });
});
