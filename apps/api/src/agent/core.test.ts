import { describe, expect, it, vi } from 'vitest';
import { agentTurn, type AgentProfile } from './core.js';
import { strategyProfile } from './profiles/strategy.js';
import { factorProfile } from './profiles/factor.js';
import { factorQaProfile } from './profiles/qa.js';
import type { AgentLlm } from '../llm/agent-llm.js';
import type { AgentTool } from './tools/types.js';

const STRATEGY = `export default defineStrategy({ name: 'x', watch: ['600519.SH'], onBar(ctx) { ctx.exit('600519.SH'); } });`;
const STRATEGY2 = `export default defineStrategy({ name: 'y', watch: ['600519.SH'], onBar(ctx) { ctx.order('600519.SH', 100); } });`;
const FACTOR = `export default defineFactor({ name: 'ep', compute: (bar) => (bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null) });`;
const FACTOR2 = `export default defineFactor({ name: 'bp', compute: (bar) => (bar.pb && bar.pb > 0 ? 1 / bar.pb : null) });`;

/** A scripted AgentLlm: pops replies in order (repeats the last one if called again). */
function scriptedLlm(replies: Awaited<ReturnType<AgentLlm>>[]) {
  let call = 0;
  return vi.fn<AgentLlm>(async () => replies[Math.min(call++, replies.length - 1)]);
}

function fakeTool(name: string, run: AgentTool['run']): AgentTool {
  return { name, description: 'test tool', parameters: { type: 'object', properties: {} }, run };
}

describe('agentTurn(strategyProfile)', () => {
  it('applies a fenced code change + returns the explanation without the fence', async () => {
    const llm = scriptedLlm([{ text: `把清仓改成买入 100 股。\n\`\`\`ts\n${STRATEGY2}\n\`\`\`` }]);
    const result = await agentTurn(strategyProfile(), [], '改成买入 100 股', STRATEGY, llm);
    expect(result.changed).toBe(true);
    expect(result.code).toBe(STRATEGY2);
    expect(result.reply).toBe('把清仓改成买入 100 股。');
    expect(result.reply).not.toContain('```');
  });

  it('keeps the current code for a pure answer (no fence)', async () => {
    const llm = scriptedLlm([{ text: '这个策略每天开盘清仓,属于示例。' }]);
    const result = await agentTurn(strategyProfile(), [], '这策略在做什么?', STRATEGY, llm);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(STRATEGY); // unchanged
    expect(result.reply).toContain('清仓');
  });

  it('feeds compile errors back, then keeps working code if it never compiles', async () => {
    const llm = scriptedLlm([{ text: '改好了\n```ts\nexport default {{ broken\n```' }]);
    const result = await agentTurn(strategyProfile(), [], '改一下', STRATEGY, llm, {
      maxRepairs: 1,
    });
    expect(result.changed).toBe(false);
    expect(result.code).toBe(STRATEGY); // working code protected
    expect(result.error).toBeTruthy();
    expect(result.attempts).toBe(2); // first + 1 repair
    expect(result.reply).toContain('保留原代码');
  });

  it('threads prior history into the model call', async () => {
    const llm = scriptedLlm([{ text: `好的。\n\`\`\`ts\n${STRATEGY2}\n\`\`\`` }]);
    await agentTurn(
      strategyProfile(),
      [{ role: 'user' as const, parts: [{ type: 'text' as const, text: '第一条' }] }],
      '第二条',
      STRATEGY,
      llm,
    );
    const messages = llm.mock.calls[0][0];
    // system + 1 history turn + the current-code user turn
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'user', content: '第一条' });
    expect(messages[2].content).toContain('当前策略代码');
    expect(messages[2].content).toContain('第二条');
  });

  it('offers the read-only tools to the model', async () => {
    const llm = scriptedLlm([{ text: '好的。' }]);
    await agentTurn(strategyProfile(), [], '你好', STRATEGY, llm);
    const offeredTools = llm.mock.calls[0][1];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      'searchInstruments',
      'dataCoverage',
      'runScreen',
      'sqlQuery',
      'renderChart',
      'analyzeData',
    ]);
  });
});

describe('agentTurn(factorProfile)', () => {
  it('applies a fenced code change + returns the explanation without the fence', async () => {
    const llm = scriptedLlm([{ text: `改成账面市值比。\n\`\`\`ts\n${FACTOR2}\n\`\`\`` }]);
    const result = await agentTurn(factorProfile(), [], '改成 BP', FACTOR, llm);
    expect(result.changed).toBe(true);
    expect(result.code).toBe(FACTOR2);
    expect(result.reply).toBe('改成账面市值比。');
  });

  it('feeds compile errors back, then keeps working code if it never compiles', async () => {
    const llm = scriptedLlm([{ text: '改好了\n```ts\nexport default {{ broken\n```' }]);
    const result = await agentTurn(factorProfile(), [], '改一下', FACTOR, llm, { maxRepairs: 1 });
    expect(result.changed).toBe(false);
    expect(result.code).toBe(FACTOR);
    expect(result.error).toBeTruthy();
    expect(result.attempts).toBe(2);
    expect(result.reply).toContain('保留原代码');
  });

  it('threads prior history into the model call', async () => {
    const llm = scriptedLlm([{ text: `好的。\n\`\`\`ts\n${FACTOR2}\n\`\`\`` }]);
    await agentTurn(
      factorProfile(),
      [{ role: 'user' as const, parts: [{ type: 'text' as const, text: '第一条' }] }],
      '第二条',
      FACTOR,
      llm,
    );
    const messages = llm.mock.calls[0][0];
    expect(messages).toHaveLength(3);
    expect(messages[2].content).toContain('当前因子代码');
    expect(messages[2].content).toContain('第二条');
  });
});

describe('agentTurn(factorQaProfile — no artifact)', () => {
  it('is a plain call: reply verbatim, code untouched, no code wrapper in the prompt', async () => {
    const llm = scriptedLlm([{ text: 'Rank IC 越高说明因子排序能力越强。\n```\n例子\n```' }]);
    const result = await agentTurn(factorQaProfile('市盈率'), [], 'IC 怎么看?', '', llm);
    expect(result.changed).toBe(false);
    expect(result.attempts).toBe(1);
    // The reply is verbatim — a Q&A answer may legitimately contain markdown fences.
    expect(result.reply).toContain('例子');
    const messages = llm.mock.calls[0][0];
    expect(messages[0].content).toContain('市盈率');
    expect(messages[1].content).toBe('IC 怎么看?'); // no current-code wrapper
  });
});

describe('agentTurn tool loop', () => {
  const okValidate = vi.fn(async () => {});
  function toolProfile(tools: AgentTool[], withArtifact = true): AgentProfile {
    return {
      system: 'test system',
      tools,
      ...(withArtifact ? { artifact: { noun: '策略', validate: okValidate } } : {}),
    };
  }

  it('executes a requested tool, feeds the observation back, then takes the final reply', async () => {
    const tool = fakeTool('echo', async (args) => ({
      observation: JSON.stringify({ got: args }),
      rows: 1,
    }));
    const llm = scriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'echo', args: '{"q":"茅台"}' }] },
      { text: `查到了。\n\`\`\`ts\n${STRATEGY2}\n\`\`\`` },
    ]);
    const result = await agentTurn(toolProfile([tool]), [], '查一下', STRATEGY, llm);
    expect(result.changed).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.toolTrace).toEqual([
      { name: 'echo', argsSummary: '{"q":"茅台"}', ok: true, rows: 1, ms: expect.any(Number) },
    ]);
    // The second call must see the assistant tool request + the tool observation.
    const secondCallMessages = llm.mock.calls[1][0];
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('茅台');
  });

  it('feeds tool failures back as observations (bad args / unknown tool), turn survives', async () => {
    const tool = fakeTool('strict', async () => {
      throw new Error('参数不合法:query 必填');
    });
    const llm = scriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'strict', args: '{}' },
          { id: 'c2', name: 'nope', args: '{}' },
        ],
      },
      { text: '没查成,直接回答。' },
    ]);
    const result = await agentTurn(toolProfile([tool], false), [], '查一下', '', llm);
    expect(result.reply).toBe('没查成,直接回答。');
    expect(result.toolTrace.map((item) => item.ok)).toEqual([false, false]);
    const secondCallMessages = llm.mock.calls[1][0];
    const observations = secondCallMessages.filter((message) => message.role === 'tool');
    expect(observations[0].content).toContain('工具执行失败');
    expect(observations[1].content).toContain('未知工具');
  });

  it('caps tool rounds, then forces a text finish with tools disabled', async () => {
    const tool = fakeTool('loop', async () => ({ observation: '{}' }));
    const llm = vi.fn<AgentLlm>(async (_messages, tools) =>
      tools.length
        ? { toolCalls: [{ id: 'x', name: 'loop', args: '{}' }] }
        : { text: '到此为止。' },
    );
    const result = await agentTurn(toolProfile([tool], false), [], '一直查', '', llm);
    expect(result.toolTrace).toHaveLength(5); // MAX_TOOL_ROUNDS
    expect(result.attempts).toBe(6); // 5 tool rounds + 1 forced finish
    expect(result.reply).toBe('到此为止。');
    // The forced-finish call got no tools and saw the cap notice.
    const lastCallArgs = llm.mock.calls[5];
    expect(lastCallArgs[1]).toEqual([]);
    expect(
      lastCallArgs[0].some(
        (message) => message.role === 'user' && message.content.includes('轮数已达上限'),
      ),
    ).toBe(true);
  });

  it('repair rounds run with tools disabled', async () => {
    const tool = fakeTool('echo', async () => ({ observation: '{}' }));
    const validate = vi
      .fn()
      .mockRejectedValueOnce(new Error('编译失败'))
      .mockResolvedValueOnce(undefined);
    const profile: AgentProfile = {
      system: 'test',
      tools: [tool],
      artifact: { noun: '策略', validate },
    };
    const llm = scriptedLlm([{ text: '改。\n```ts\nbad\n```' }, { text: 'good-code' }]);
    const result = await agentTurn(profile, [], '改', STRATEGY, llm);
    expect(result.changed).toBe(true);
    expect(result.code).toBe('good-code');
    expect(result.attempts).toBe(2);
    expect(llm.mock.calls[1][1]).toEqual([]); // repair call offered no tools
  });

  it('collects query cards side-produced by tools', async () => {
    const spec = { filters: [] };
    const tool = fakeTool('runScreen', async () => ({
      observation: '{"total":1}',
      rows: 1,
      card: { title: '全市场快照', spec },
    }));
    const llm = scriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'runScreen', args: '{"filters":[]}' }] },
      { text: '筛好了,见卡片。' },
    ]);
    const result = await agentTurn(toolProfile([tool], false), [], '筛一下', '', llm);
    expect(result.cards).toEqual([{ title: '全市场快照', spec }]);
  });

  it('fires streaming hooks: deltas forwarded, tool start/done, repair announced (no repair deltas)', async () => {
    const tool = fakeTool('echo', async () => ({ observation: '{}', rows: 2 }));
    const validate = vi
      .fn()
      .mockRejectedValueOnce(new Error('编译失败'))
      .mockResolvedValueOnce(undefined);
    const profile: AgentProfile = {
      system: 'test',
      tools: [tool],
      artifact: { noun: '策略', validate },
    };
    // The mock streams its text through opts.onDelta (like the real chatTools).
    const replies = [
      { toolCalls: [{ id: 'c1', name: 'echo', args: '{}' }] },
      { text: '改。\n```ts\nbad\n```' },
      { text: 'good-code' },
    ];
    let call = 0;
    const llm = vi.fn<AgentLlm>(async (_messages, _tools, llmOpts) => {
      const reply = replies[Math.min(call++, replies.length - 1)];
      if (reply.text) {
        llmOpts?.onDelta?.(reply.text);
      }
      return reply;
    });

    const hooks = {
      onDelta: vi.fn(),
      onToolStart: vi.fn(),
      onToolDone: vi.fn(),
      onRepair: vi.fn(),
    };
    const result = await agentTurn(profile, [], '改', STRATEGY, llm, { hooks });
    expect(result.changed).toBe(true);
    expect(hooks.onToolStart).toHaveBeenCalledWith('echo', '{}');
    expect(hooks.onToolDone).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'echo', ok: true, rows: 2 }),
    );
    expect(hooks.onRepair).toHaveBeenCalledWith(1, '编译失败');
    // Deltas only from the tool/produce phase — the repair call got no onDelta.
    expect(hooks.onDelta.mock.calls.map((args) => args[0])).toEqual(['改。\n```ts\nbad\n```']);
    expect(llm.mock.calls[2][2]?.onDelta).toBeUndefined(); // repair round
  });

  it('aborts between rounds when the signal fires', async () => {
    const controller = new AbortController();
    const tool = fakeTool('echo', async () => {
      controller.abort(); // cancelled while a tool is running
      return { observation: '{}' };
    });
    const llm = scriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'echo', args: '{}' }] },
      { text: '不该到这' },
    ]);
    await expect(
      agentTurn(toolProfile([tool], false), [], '查', '', llm, {
        hooks: { signal: controller.signal },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
