import { describe, expect, it } from 'vitest';
import { EQUITY_FCFF_REPLAY_CASES, equityFcffParameterSource } from './equity-fcff-replay-cases.js';

describe('equity FCFF replay cases', () => {
  it('covers three distinct business patterns with explicit three-way scenarios', () => {
    expect(EQUITY_FCFF_REPLAY_CASES.map((item) => item.identifier)).toEqual([
      '000858.SZ',
      '000333.SZ',
      '300750.SZ',
    ]);
    expect(new Set(EQUITY_FCFF_REPLAY_CASES.map((item) => item.businessPattern)).size).toBe(3);
    for (const replayCase of EQUITY_FCFF_REPLAY_CASES) {
      expect(replayCase.scenarios.map((scenario) => scenario.scenario)).toEqual([
        'downside',
        'base',
        'upside',
      ]);
      const source = equityFcffParameterSource(replayCase);
      expect(source).toContain(`valuation_identifier = "${replayCase.identifier}"`);
      expect(source).toContain('# These are explicit teaching assumptions');
    }
  });
});
