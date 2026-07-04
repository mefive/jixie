import { describe, expect, it, vi } from 'vitest';
import { factorAgentTurn } from './factor-agent.js';
import type { LlmCall } from '../llm/nl-to-structured.js';

const GOOD = `export default defineFactor({ name: 'ep', compute: (bar) => (bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null) });`;
const GOOD2 = `export default defineFactor({ name: 'bp', compute: (bar) => (bar.pb && bar.pb > 0 ? 1 / bar.pb : null) });`;

describe('factorAgentTurn', () => {
  it('applies a fenced code change + returns the explanation without the fence', async () => {
    const llm: LlmCall = vi.fn(async () => `改成账面市值比。\n\`\`\`ts\n${GOOD2}\n\`\`\``);
    const result = await factorAgentTurn([], '改成 BP', GOOD, llm);
    expect(result.changed).toBe(true);
    expect(result.code).toBe(GOOD2);
    expect(result.reply).toBe('改成账面市值比。');
    expect(result.reply).not.toContain('```');
  });

  it('keeps the current code for a pure answer (no fence)', async () => {
    const llm: LlmCall = vi.fn(async () => 'EP 是盈利收益率,越大越便宜。');
    const result = await factorAgentTurn([], '这因子啥意思?', GOOD, llm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(GOOD);
    expect(result.reply).toContain('盈利收益率');
  });

  it('feeds compile errors back, then keeps working code if it never compiles', async () => {
    const llm: LlmCall = vi.fn(async () => '改好了\n```ts\nexport default {{ broken\n```');
    const result = await factorAgentTurn([], '改一下', GOOD, llm, { maxRepairs: 1 });
    expect(result.changed).toBe(false);
    expect(result.code).toBe(GOOD);
    expect(result.error).toBeTruthy();
    expect(result.attempts).toBe(2);
    expect(result.reply).toContain('保留原代码');
  });

  it('threads prior history into the model call', async () => {
    const llm = vi.fn<LlmCall>(async () => `好的。\n\`\`\`ts\n${GOOD2}\n\`\`\``);
    await factorAgentTurn([{ role: 'user', content: '第一条' }], '第二条', GOOD, llm);
    const messages = llm.mock.calls[0][0];
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'user', content: '第一条' });
    expect(messages[2].content).toContain('当前因子代码');
    expect(messages[2].content).toContain('第二条');
  });
});
