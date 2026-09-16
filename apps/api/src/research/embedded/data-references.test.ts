import { describe, expect, it } from 'vitest';
import { embeddedDataReferencesSchema } from '../schema.js';
import { embeddedUserParts } from './data-references.js';

describe('chat data references use the Research request contract', () => {
  it('accepts an exact report reference without treating it as already loaded data', () => {
    const reference = {
      label: 'Selected report',
      method: 'research_factor_report',
      arguments: { report_id: 'report-1' },
    };
    expect(embeddedDataReferencesSchema.parse([reference])).toEqual([reference]);
    expect(embeddedDataReferencesSchema.parse(undefined)).toEqual([]);
    expect(embeddedUserParts('Explain this', [reference])).toEqual([
      { type: 'text', text: 'Explain this' },
      { type: 'research_data_references', references: [reference] },
    ]);
  });
  it('rejects invented SDK methods, invalid parameters and oversized attachments', () => {
    const reference = {
      label: 'Report',
      method: 'research_factor_report',
      arguments: { report_id: 'report-1' },
    };
    expect(
      embeddedDataReferencesSchema.safeParse([{ ...reference, method: 'research_execute_sql' }])
        .success,
    ).toBe(false);
    expect(embeddedDataReferencesSchema.safeParse([{ ...reference, arguments: {} }]).success).toBe(
      false,
    );
    expect(embeddedDataReferencesSchema.safeParse(Array(9).fill(reference)).success).toBe(false);
    expect(
      embeddedDataReferencesSchema.safeParse([
        { ...reference, arguments: { report_id: 'x'.repeat(20_000) } },
      ]).success,
    ).toBe(false);
  });
});
