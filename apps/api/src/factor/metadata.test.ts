import { describe, expect, it, vi } from 'vitest';
import { generateFactorMetadata } from './metadata.js';
import type { LlmCall } from '../llm/deepseek.js';

describe('factor metadata', () => {
  it('parses structured bilingual metadata and includes recent context', async () => {
    const llm = vi.fn<LlmCall>(async () =>
      JSON.stringify({
        nameZh: '盈利收益率',
        descriptionZh: '市盈率倒数,数值越高代表估值越低。',
        descriptionEn: 'Inverse PE; higher values indicate cheaper valuation.',
      }),
    );
    const metadata = await generateFactorMetadata(
      {
        code: 'export default defineFactor({ compute: (bar) => 1 / bar.peTtm });',
        messages: [{ role: 'user', parts: [{ type: 'text', text: '做一个盈利收益率因子' }] }],
      },
      llm,
    );

    expect(metadata).toEqual({
      nameZh: '盈利收益率',
      descriptionZh: '市盈率倒数,数值越高代表估值越低。',
      descriptionEn: 'Inverse PE; higher values indicate cheaper valuation.',
    });
    expect(llm.mock.calls[0]?.[0][1]?.content).toContain('做一个盈利收益率因子');
  });
});
