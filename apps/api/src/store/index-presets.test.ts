import { describe, expect, it } from 'vitest';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_CODES,
  MARKET_WEATHER_INDEX_BENCHMARKS,
  MARKET_WEATHER_INDEX_CODES,
  MARKET_WEATHER_INDEX_GROUPS,
  MARKET_WEATHER_INDICATOR_INDEX_CODES,
} from './index-presets.js';

describe('market weather index presets', () => {
  it('keeps CSI All Share in the core daily set for residual-volatility factors', () => {
    expect(MAJOR_INDEX_DAILY_CODES).toContain('000985.CSI');
    expect(DAILY_MAINTAINED_INDEX_CODES).toContain('000985.CSI');
  });

  it('keeps the 34-card allowlist unique and fully covered by constituent indicators', () => {
    expect(MARKET_WEATHER_INDEX_CODES).toHaveLength(34);
    expect(new Set(MARKET_WEATHER_INDEX_CODES).size).toBe(34);
    expect(MARKET_WEATHER_INDICATOR_INDEX_CODES).toEqual(MARKET_WEATHER_INDEX_CODES);
  });

  it('includes the approved broad, board, and core-factor additions', () => {
    expect(MARKET_WEATHER_INDEX_GROUPS.scale.flatMap((group) => group.codes)).toContain(
      '000906.SH',
    );
    expect(MARKET_WEATHER_INDEX_GROUPS.board.flatMap((group) => group.codes)).toContain(
      '399102.SZ',
    );
    expect(MARKET_WEATHER_INDEX_GROUPS.style.flatMap((group) => group.codes)).toEqual(
      expect.arrayContaining(['000984.CSI', 'H30260.CSI', '930860.CSI', '930955.CSI', '980092.SZ']),
    );
  });

  it('assigns parent benchmarks to every newly added factor index', () => {
    for (const code of ['000984.CSI', 'H30260.CSI', '930860.CSI', '930955.CSI', '980092.SZ']) {
      expect(MARKET_WEATHER_INDEX_BENCHMARKS[code]).toBeTruthy();
    }
  });
});
