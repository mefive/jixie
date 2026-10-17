import { describe, expect, it } from 'vitest';
import { researchCellRunFrameSchema } from './protocol.js';

describe('research Python protocol', () => {
  it('rejects unrecognized Research output fields and request methods', () => {
    expect(() =>
      researchCellRunFrameSchema.parse({
        type: 'research_executed',
        outputs: [{ type: 'text', text: 'result', executable: true }],
        definitions: [],
        references: [],
      }),
    ).toThrow();
    expect(() =>
      researchCellRunFrameSchema.parse({
        type: 'request',
        id: 1,
        method: 'read_file',
        arguments: { path: '/etc/passwd' },
      }),
    ).toThrow();
    expect(
      researchCellRunFrameSchema.parse({
        type: 'request',
        id: 2,
        method: 'research_factor_report',
        arguments: { report_id: 'report-1' },
      }),
    ).toMatchObject({ method: 'research_factor_report' });
  });
});
