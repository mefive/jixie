import { messageText, textMessage, type ChatMessage } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { compactResearchAgentHistory, researchAgentDocumentContext } from './agent-context.js';

describe('compactResearchAgentHistory', () => {
  it('keeps the original goal, confirmed catalog choices, and the recent conversation', () => {
    const clarification: ChatMessage = {
      role: 'assistant',
      parts: [
        {
          type: 'research_clarification',
          clarification: {
            version: 1,
            id: 'clarification-1',
            documentId: 'document-1',
            title: 'Choose a rate',
            status: 'answered',
            questions: [
              {
                id: 'rate',
                prompt: 'Which rate?',
                selectionMode: 'single',
                allowCustom: false,
                options: [
                  {
                    id: 'option-1',
                    kind: 'binding',
                    referenceId: 'macro.china.rate.lpr_1y',
                    labelZh: '一年期 LPR',
                    labelEn: '1Y LPR',
                    descriptionZh: '贷款市场报价利率',
                    descriptionEn: 'Loan prime rate',
                  },
                ],
              },
            ],
            answer: {
              selections: [{ questionId: 'rate', selectedOptionIds: ['option-1'] }],
              answeredAt: '2026-09-01T00:00:00.000Z',
            },
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        },
      ],
    };
    const history = [
      textMessage('user', '研究黄金价格与实际利率的关系'),
      textMessage('assistant', 'old-noise-that-should-disappear'),
      clarification,
      ...Array.from({ length: 4 }, (_, index) =>
        textMessage(index % 2 === 0 ? 'user' : 'assistant', `middle-${index}`),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        textMessage(index % 2 === 0 ? 'user' : 'assistant', `recent-${index}-${'x'.repeat(5_000)}`),
      ),
    ];

    const compacted = compactResearchAgentHistory(history);
    const text = compacted.map(messageText).join('\n');

    expect(compacted).toHaveLength(10);
    expect(text).toContain('研究黄金价格与实际利率的关系');
    expect(text).toContain('macro.china.rate.lpr_1y');
    expect(text).toContain('recent-0');
    expect(text).toContain('recent-7');
    expect(text).not.toContain('old-noise-that-should-disappear');
    expect(
      compacted.reduce((total, message) => total + messageText(message).length, 0),
    ).toBeLessThanOrEqual(20_000);
  });

  it('leaves short recent history unchanged', () => {
    const history = [textMessage('user', 'question'), textMessage('assistant', 'answer')];

    expect(compactResearchAgentHistory(history)).toEqual(history);
  });
});

describe('researchAgentDocumentContext', () => {
  it('includes bounded summaries for only the latest executed Cells', () => {
    const cells = Array.from({ length: 6 }, (_, index) => ({
      id: `cell-${index}`,
      position: index,
      kind: 'python',
      source: `value_${index} = ${index}`,
      status: 'success',
      revision: 1,
      definitions: [`value_${index}`],
      references: [],
      output:
        index === 5
          ? [
              { type: 'value', value: 0.42 },
              {
                type: 'table',
                columns: ['date', 'return'],
                rows: [{ date: 'secret-row', return: 0.1 }],
                rowCount: 100,
                truncated: true,
              },
              {
                type: 'image',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,secret-image',
                width: 800,
                height: 600,
              },
            ]
          : [{ type: 'text', text: `result-${index}` }],
      lastExecutedRevision: 1,
      lastExecutedAt: new Date(`2026-09-01T0${index}:00:00.000Z`),
    }));

    const result = researchAgentDocumentContext({
      id: 'document-1',
      updatedAt: new Date('2026-09-01T12:00:00.000Z'),
      contentRevision: 7,
      cells,
    });
    const context = JSON.parse(result.context) as {
      version: number;
      cells: Array<Record<string, unknown>>;
      outputSummaryCellLimit: number;
    };

    expect(context.version).toBe(2);
    expect(context.outputSummaryCellLimit).toBe(5);
    expect(context.cells[0]).not.toHaveProperty('latestOutputSummary');
    expect(context.cells[1]).toHaveProperty('latestOutputSummary');
    expect(context.cells[5]).toMatchObject({
      outputTypes: ['value', 'table', 'image'],
      latestOutputSummary: [
        { type: 'value', value: 0.42 },
        { type: 'table', columns: ['date', 'return'], rowCount: 100, truncated: true },
        { type: 'image', mimeType: 'image/png', width: 800, height: 600 },
      ],
    });
    expect(result.context).not.toContain('secret-row');
    expect(result.context).not.toContain('secret-image');
    expect(result.editableCellIds).toEqual(new Set(cells.map((cell) => cell.id)));
  });

  it('never marks a Cell with truncated source as editable', () => {
    const result = researchAgentDocumentContext({
      id: 'document-1',
      updatedAt: new Date('2026-09-01T12:00:00.000Z'),
      contentRevision: 1,
      cells: [
        {
          id: 'large-cell',
          position: 0,
          kind: 'python',
          source: 'x'.repeat(48_001),
          status: 'idle',
          revision: 1,
          definitions: [],
          references: [],
          output: null,
          lastExecutedRevision: null,
          lastExecutedAt: null,
        },
      ],
    });
    const context = JSON.parse(result.context) as { cells: Array<{ sourceTruncated: boolean }> };

    expect(context.cells[0].sourceTruncated).toBe(true);
    expect(result.editableCellIds).not.toContain('large-cell');
  });
});
