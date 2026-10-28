import { DEFAULT_INDEX_DOWNLOADS } from '../downloads/lists.js';
const MAJOR_INDEX_DAILY_CODES = DEFAULT_INDEX_DOWNLOADS.map((row) => row.tsCode);
const DAILY_MAINTAINED_INDEX_CODES = MAJOR_INDEX_DAILY_CODES;
import { describe, expect, it } from 'vitest';
import { CSI_300_TOTAL_RETURN_INDEX_CODE } from './index-presets.js';

describe('index source presets', () => {
  it('keeps CSI All Share in the core daily set for residual-volatility factors', () => {
    expect(MAJOR_INDEX_DAILY_CODES).toContain('000985.CSI');
    expect(DAILY_MAINTAINED_INDEX_CODES).toContain('000985.CSI');
  });

  it('keeps the CSI 300 total-return benchmark in daily maintenance', () => {
    expect(CSI_300_TOTAL_RETURN_INDEX_CODE).toBe('H00300.CSI');
    expect(MAJOR_INDEX_DAILY_CODES).toContain(CSI_300_TOTAL_RETURN_INDEX_CODE);
    expect(DAILY_MAINTAINED_INDEX_CODES).toContain(CSI_300_TOTAL_RETURN_INDEX_CODE);
  });
});
