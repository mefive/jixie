import { describe, expect, it } from 'vitest';
import { messageText, normalizeChatMessage } from '@jixie/shared';
import { chatMessagesSchema } from '@jixie/shared/api/agent';

describe('retired chat chart messages', () => {
  it.each([
    { kind: 'line', sql: 'SELECT close FROM Daily', x: 'date', series: [{ column: 'close' }] },
    {
      source: 'compute',
      queries: [{ name: 'prices', sql: 'SELECT close FROM Daily' }],
      code: 'export default ({ data }) => data.prices',
    },
    null,
  ])(
    'projects historical chart data into a title-only notice without changing storage',
    (chart) => {
      const stored = {
        id: 'message-1',
        role: 'assistant',
        turnId: 'turn-1',
        sequence: 2,
        createdAt: '2026-09-14T08:00:00.000Z',
        parts: [
          { type: 'text', text: 'Original explanation' },
          { type: 'chart', title: 'Saved chart', chart },
        ],
      };
      const before = JSON.stringify(stored);
      const message = normalizeChatMessage(stored);

      expect(message).toEqual({
        ...stored,
        parts: [
          { type: 'text', text: 'Original explanation' },
          { type: 'retired_chart', title: 'Saved chart' },
        ],
      });
      expect(JSON.stringify(stored)).toBe(before);
      expect(normalizeChatMessage(message)).toEqual(message);
      expect(chatMessagesSchema.safeParse([message]).success).toBe(true);
      expect(chatMessagesSchema.safeParse([stored]).success).toBe(false);
      expect(messageText(message)).toBe(
        'Original explanation\n(retired historical chart: Saved chart)',
      );
    },
  );

  it('does not inspect an executable specification while reading a historical notice', () => {
    const part = Object.defineProperty({ type: 'chart', title: 'Saved' }, 'chart', {
      get() {
        throw new Error('The retired specification must not be read');
      },
    });

    expect(normalizeChatMessage({ role: 'assistant', parts: [part] }).parts).toEqual([
      { type: 'retired_chart', title: 'Saved' },
    ]);
  });

  it('bounds titles and keeps incomplete historical records visible', () => {
    expect(
      normalizeChatMessage({
        role: 'assistant',
        parts: [
          { type: 'chart', title: 'x'.repeat(200) },
          { type: 'chart', title: null },
        ],
      }).parts,
    ).toEqual([
      { type: 'retired_chart', title: 'x'.repeat(120) },
      { type: 'retired_chart', title: '' },
    ]);
  });

  it('rejects executable fields in new notice requests and strips them from saved notices', () => {
    const message = {
      role: 'assistant',
      parts: [
        { type: 'retired_chart', title: 'Saved', code: 'throw new Error()', sql: 'SELECT 1' },
      ],
    };

    expect(chatMessagesSchema.safeParse([message]).success).toBe(false);
    expect(normalizeChatMessage(message).parts).toEqual([
      { type: 'retired_chart', title: 'Saved' },
    ]);
  });
});
