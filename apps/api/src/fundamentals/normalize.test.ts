import { describe, expect, it } from 'vitest';

import { normalizeCumulativeFlows, previousQuarterEnd, previousYearPeriod } from './normalize.js';

describe('financial flow normalization', () => {
  it('converts YTD values to quarters and exactly four continuous quarters to TTM', () => {
    const result = normalizeCumulativeFlows(
      [
        row('20230331', 10),
        row('20230630', 25),
        row('20230930', 45),
        row('20231231', 70),
        row('20240331', 20),
      ],
      ['amount'],
    );

    expect(result.quarterly.map((quarter) => quarter.values.amount.value)).toEqual([
      10, 15, 20, 25, 20,
    ]);
    expect(
      result.trailingTwelveMonths.find((flow) => flow.endDate === '20231231')?.values.amount.value,
    ).toBe(70);
    expect(
      result.trailingTwelveMonths.find((flow) => flow.endDate === '20240331')?.values.amount.value,
    ).toBe(80);
  });

  it('returns a reason instead of inventing a missing quarter', () => {
    const result = normalizeCumulativeFlows(
      [row('20230331', 10), row('20230930', 45), row('20231231', 70)],
      ['amount'],
    );

    expect(
      result.quarterly.find((flow) => flow.endDate === '20230930')?.values.amount,
    ).toMatchObject({ value: null, missingReason: 'missing_previous_cumulative_period' });
    expect(
      result.trailingTwelveMonths.find((flow) => flow.endDate === '20230930')?.values.amount,
    ).toMatchObject({ value: null, missingReason: 'incomplete_trailing_twelve_months' });
    expect(
      result.trailingTwelveMonths.find((flow) => flow.endDate === '20231231')?.values.amount,
    ).toMatchObject({ value: 70 });
  });

  it('rejects non-calendar report ends and provides deterministic period offsets', () => {
    const result = normalizeCumulativeFlows([row('20230228', 10)], ['amount']);

    expect(result.quarterly).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'non_standard_report_period' })]),
    );
    expect(previousQuarterEnd('20240331')).toBe('20231231');
    expect(previousQuarterEnd('20240930')).toBe('20240630');
    expect(previousYearPeriod('20240930', 3)).toBe('20210930');
  });
});

function row(endDate: string, amount: number) {
  return {
    statementKind: 'income' as const,
    endDate,
    sourceRowFingerprint: `income-${endDate}`,
    values: { amount },
  };
}
