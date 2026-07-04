import { describe, expect, it, vi } from 'vitest';
import { agentTurn } from './agent.js';
import type { LlmCall } from '../../llm/nl-to-structured.js';

const GOOD = `export default defineStrategy({ name: 'x', watch: ['600519.SH'], onBar(ctx) { ctx.exit('600519.SH'); } });`;
const GOOD2 = `export default defineStrategy({ name: 'y', watch: ['600519.SH'], onBar(ctx) { ctx.order('600519.SH', 100); } });`;

describe('agentTurn', () => {
  it('applies a fenced code change + returns the explanation without the fence', async () => {
    const llm: LlmCall = vi.fn(async () => `把清仓改成买入 100 股。\n\`\`\`ts\n${GOOD2}\n\`\`\``);
    const result = await agentTurn([], '改成买入 100 股', GOOD, llm);
    expect(result.changed).toBe(true);
    expect(result.code).toBe(GOOD2);
    expect(result.reply).toBe('把清仓改成买入 100 股。');
    expect(result.reply).not.toContain('```');
  });

  it('keeps the current code for a pure answer (no fence)', async () => {
    const llm: LlmCall = vi.fn(async () => '这个策略每天开盘清仓,属于示例。');
    const result = await agentTurn([], '这策略在做什么?', GOOD, llm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(GOOD); // unchanged
    expect(result.reply).toContain('清仓');
  });

  it('feeds compile errors back, then keeps working code if it never compiles', async () => {
    const llm: LlmCall = vi.fn(async () => '改好了\n```ts\nexport default {{ broken\n```');
    const result = await agentTurn([], '改一下', GOOD, llm, { maxRepairs: 1 });
    expect(result.changed).toBe(false);
    expect(result.code).toBe(GOOD); // working code protected
    expect(result.error).toBeTruthy();
    expect(result.attempts).toBe(2); // first + 1 repair
    expect(result.reply).toContain('保留原代码');
  });

  it('threads prior history into the model call', async () => {
    const llm = vi.fn<LlmCall>(async () => `好的。\n\`\`\`ts\n${GOOD2}\n\`\`\``);
    await agentTurn([{ role: 'user', content: '第一条' }], '第二条', GOOD, llm);
    const messages = llm.mock.calls[0][0];
    // system + 1 history turn + the current-code user turn
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'user', content: '第一条' });
    expect(messages[2].content).toContain('当前策略代码');
    expect(messages[2].content).toContain('第二条');
  });
});
