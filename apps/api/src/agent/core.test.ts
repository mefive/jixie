import { describe, expect, it, vi } from 'vitest';
import { agentTurn, turnParts, type AgentProfile } from './core.js';
import { strategyProfile } from './profiles/strategy.js';
import { factorProfile } from './profiles/factor.js';
import { factorQaProfile } from './profiles/qa.js';
import type { AgentLlm } from '../llm/agent-llm.js';
import type { AgentTool } from './tools/types.js';

const STRATEGY = `export default defineStrategy({ name: 'x', watch: ['600519.SH'], onBar(ctx) { ctx.exit('600519.SH'); } });`;
const STRATEGY2 = `export default defineStrategy({ name: 'y', watch: ['600519.SH'], onBar(ctx) { ctx.order('600519.SH', 100); } });`;
const FACTOR = `export default defineFactor({ name: 'ep', compute: (bar) => (bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null) });`;
const FACTOR2 = `export default defineFactor({ name: 'bp', compute: (bar) => (bar.pb && bar.pb > 0 ? 1 / bar.pb : null) });`;
const TIME_SERIES_FACTOR = `export default defineFactorV2({ version: 2, name: 'ETF trend', analysisKind: 'time_series', outputScope: 'asset', frequency: 'daily', inputs: ['etf.adjustedClose'], targetAssetClasses: ['equity', 'fixed_income', 'commodity'], window: 21, compute(ctx) { const now = ctx.value('etf.adjustedClose'); const before = ctx.lag('etf.adjustedClose', 20); return now != null && before != null && before > 0 ? now / before - 1 : null; } });`;
const TIME_SERIES_FACTOR2 = TIME_SERIES_FACTOR.replace('window: 21', 'window: 61').replace(
  ', 20);',
  ', 60);',
);
const PYTHON_FACTOR = `from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="盈利收益率")

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    return 1 / bar.pe_ttm if bar.pe_ttm is not None and bar.pe_ttm > 0 else None`;

/** A scripted AgentLlm: pops replies in order (repeats the last one if called again). */
function scriptedLlm(replies: Awaited<ReturnType<AgentLlm>>[]) {
  let call = 0;
  return vi.fn<AgentLlm>(async () => replies[Math.min(call++, replies.length - 1)]);
}

function fakeTool(name: string, run: AgentTool['run']): AgentTool {
  return { name, description: 'test tool', parameters: { type: 'object', properties: {} }, run };
}

describe('agentTurn(strategyProfile)', () => {
  it('extracts a full python fence without leaving the short py alias behind', async () => {
    const code = 'from jixie import Strategy\nstrategy = Strategy(name="x")';
    const profile: AgentProfile = {
      system: 'Return Python code.',
      artifact: { noun: 'strategy', language: 'python', validate: async () => {} },
    };
    const result = await agentTurn(
      profile,
      [],
      '生成 Python',
      'pass',
      scriptedLlm([{ text: `完成。\n\`\`\`python\n${code}\n\`\`\`` }]),
    );

    expect(result.code).toBe(code);
    expect(result.reply).toBe('完成。');
  });

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
    expect(messages[2].content).toContain('Current strategy code');
    expect(messages[2].content).toContain('第二条');
  });

  it('lets a profile bound model history without changing the caller history', async () => {
    const history = [
      { role: 'user' as const, parts: [{ type: 'text' as const, text: 'older' }] },
      { role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'recent' }] },
    ];
    const profile: AgentProfile = {
      system: 'test',
      prepareHistory: (messages) => messages.slice(-1),
    };
    const llm = scriptedLlm([{ text: 'done' }]);

    await agentTurn(profile, history, 'current', '', llm);

    expect(llm.mock.calls[0][0]).toEqual([
      { role: 'system', content: 'test' },
      { role: 'assistant', content: 'recent' },
      { role: 'user', content: 'current' },
    ]);
    expect(history).toHaveLength(2);
  });

  it('offers the read-only tools to the model', async () => {
    const llm = scriptedLlm([{ text: '好的。' }]);
    await agentTurn(strategyProfile(), [], '你好', STRATEGY, llm);
    const offeredTools = llm.mock.calls[0][1];
    expect(offeredTools.map((tool) => tool.name)).toEqual([
      'searchInstruments',
      'dataCoverage',
      'runUniverse',
      'sqlQuery',
      'renderChart',
      'renderComputedChart',
      'analyzeData',
    ]);
  });

  it('offers quick backtesting only when the strategy route supplies research context', async () => {
    const llm = scriptedLlm([{ text: '好的。' }]);
    await agentTurn(
      strategyProfile(undefined, undefined, {
        userId: 'user-1',
        strategyId: 'strategy-1',
        currentCode: STRATEGY,
        locale: 'zh',
      }),
      [],
      '先试跑',
      STRATEGY,
      llm,
    );

    expect(llm.mock.calls[0][1].map((tool) => tool.name)).toContain('runQuickBacktest');
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
    expect(messages[2].content).toContain('Current factor code');
    expect(messages[2].content).toContain('第二条');
  });

  it('offers factor analysis only when the factor route supplies research context', async () => {
    const llm = scriptedLlm([{ text: '好的。' }]);
    await agentTurn(
      factorProfile({
        userId: 'user-1',
        factorId: 'factor-1',
        currentCode: FACTOR,
        locale: 'zh',
      }),
      [],
      '先做 explore 分析',
      FACTOR,
      llm,
    );

    expect(llm.mock.calls[0][1].map((tool) => tool.name)).toContain('runFactorAnalysis');
    expect(llm.mock.calls[0][0][0].content).toContain('Research execution discipline');
  });

  it('authors Factor Definition V2 for time-series factors without exposing the cross-sectional research tool', async () => {
    const llm = scriptedLlm([
      { text: `改成 60 日趋势。\n\`\`\`ts\n${TIME_SERIES_FACTOR2}\n\`\`\`` },
    ]);
    const result = await agentTurn(
      factorProfile({
        userId: 'user-1',
        factorId: 'factor-1',
        currentCode: TIME_SERIES_FACTOR,
        locale: 'zh',
        analysisKind: 'time_series',
      }),
      [],
      '改成 60 日趋势',
      TIME_SERIES_FACTOR,
      llm,
    );

    expect(result.changed).toBe(true);
    expect(result.code).toBe(TIME_SERIES_FACTOR2);
    expect(llm.mock.calls[0][0][0].content).toContain('Factor Definition V2');
    expect(llm.mock.calls[0][1].map((tool) => tool.name)).not.toContain('runFactorAnalysis');
    expect(llm.mock.calls[0][1].map((tool) => tool.name)).toContain('runTimeSeriesFactorAnalysis');
    expect(llm.mock.calls[0][0][0].content).toContain('Research execution discipline');
  });

  it('authors and validates Python Factors with a Python conversation contract', async () => {
    const llm = scriptedLlm([
      { text: `已改为盈利收益率。\n\`\`\`python\n${PYTHON_FACTOR}\n\`\`\`` },
    ]);
    const result = await agentTurn(
      factorProfile({
        userId: 'user-1',
        factorId: 'factor-python',
        currentCode: PYTHON_FACTOR,
        locale: 'zh',
        language: 'python',
      }),
      [],
      '改成盈利收益率',
      PYTHON_FACTOR.replace('pe_ttm', 'pb'),
      llm,
    );

    expect(result.changed).toBe(true);
    expect(result.code).toBe(PYTHON_FACTOR);
    expect(llm.mock.calls[0][0][0].content).toContain('```python');
    expect(llm.mock.calls[0][0][0].content).toContain('Factor.cross_sectional');
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
      {
        reasoningContent: '需要先查询本地数据。',
        toolCalls: [{ id: 'c1', name: 'echo', args: '{"q":"茅台"}' }],
      },
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
    const assistantToolCall = secondCallMessages.find(
      (message) => message.role === 'assistant' && message.toolCalls?.length,
    );
    expect(assistantToolCall?.role).toBe('assistant');
    if (assistantToolCall?.role === 'assistant') {
      expect(assistantToolCall.reasoningContent).toBe('需要先查询本地数据。');
    }
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
    expect(observations[0].content).toContain('Tool execution failed');
    expect(observations[1].content).toContain('Unknown tool');
  });

  it('repairs plain-text tool protocol before publishing or returning a final reply', async () => {
    const leaked = '< | DSML | tool_calls> < | DSML | invoke name="sqlQuery">SELECT * FROM Daily';
    const replies = [leaked, '查询调用失败，暂时无法得出可靠结论。'];
    let call = 0;
    const llm = vi.fn<AgentLlm>(async (_messages, _tools, opts) => {
      const text = replies[Math.min(call++, replies.length - 1)];
      opts?.onDelta?.(text);
      return { text };
    });
    const onDelta = vi.fn();

    const result = await agentTurn(toolProfile([], false), [], '查一下', '', llm, {
      hooks: { onDelta },
    });

    expect(result.reply).toBe('查询调用失败，暂时无法得出可靠结论。');
    expect(result.attempts).toBe(2);
    expect(llm.mock.calls[1][1]).toEqual([]);
    expect(onDelta).toHaveBeenCalledOnce();
    expect(onDelta).toHaveBeenCalledWith('查询调用失败，暂时无法得出可靠结论。');
  });

  it('recovers fullwidth DSML requests as whitelisted tool calls', async () => {
    const tool = fakeTool('sqlQuery', async (args) => ({
      observation: JSON.stringify({ args }),
      rows: 1,
    }));
    const leaked =
      '先查询两只 ETF。<｜｜DSML｜｜tool_calls>' +
      '<｜｜DSML｜｜invoke name="sqlQuery"><｜｜DSML｜｜parameter name="sql" string="true">SELECT close FROM etfDaily WHERE ticker = \'510300.SH\'' +
      '<｜｜DSML｜｜invoke name="sqlQuery"><｜｜DSML｜｜parameter name="sql" string="true">SELECT close FROM etfDaily WHERE ticker = \'518880.SH\'';
    const llm = scriptedLlm([
      { text: leaked },
      { text: '沪深300ETF 与黄金ETF 的近一年表现已经完成比较。' },
    ]);
    const onDelta = vi.fn();

    const result = await agentTurn(toolProfile([tool], false), [], '查询 ETF', '', llm, {
      hooks: { onDelta },
    });

    expect(result.reply).toContain('已经完成比较');
    expect(result.attempts).toBe(2);
    expect(result.toolTrace).toHaveLength(2);
    const recoveredRequest = llm.mock.calls[1][0].find(
      (message) => message.role === 'assistant' && message.toolCalls?.length,
    );
    expect(recoveredRequest?.role).toBe('assistant');
    if (recoveredRequest?.role === 'assistant') {
      expect(recoveredRequest.content).toBeNull();
      expect(recoveredRequest.toolCalls?.map((call) => JSON.parse(call.args))).toEqual([
        { sql: "SELECT close FROM etfDaily WHERE ticker = '510300.SH'" },
        { sql: "SELECT close FROM etfDaily WHERE ticker = '518880.SH'" },
      ]);
    }
    expect(llm.mock.calls[1][0].filter((message) => message.role === 'tool')).toHaveLength(2);
    expect(onDelta).toHaveBeenCalledOnce();
    expect(onDelta).toHaveBeenCalledWith('沪深300ETF 与黄金ETF 的近一年表现已经完成比较。');
  });

  it('asks for a structured retry when serialized protocol cannot be parsed', async () => {
    const tool = fakeTool('sqlQuery', async () => ({
      observation: '{"rows":[{"close":4.7}]}',
      rows: 1,
    }));
    const llm = scriptedLlm([
      { text: '<｜｜DSML｜｜tool_calls>' },
      { toolCalls: [{ id: 'c1', name: 'sqlQuery', args: '{"sql":"SELECT close"}' }] },
      { text: '沪深300ETF 最新收盘价为 4.7。' },
    ]);

    const result = await agentTurn(toolProfile([tool], false), [], '查询 ETF', '', llm);

    expect(result.reply).toContain('4.7');
    expect(result.attempts).toBe(3);
    expect(
      llm.mock.calls[1][0].some(
        (message) =>
          message.role === 'user' && message.content.includes('structured tool-call interface'),
      ),
    ).toBe(true);
  });

  it('fails the turn when tool protocol still leaks after repair', async () => {
    const leaked = '<tool_calls><invoke name="sqlQuery"><parameter name="sql">SELECT 1';
    const llm = scriptedLlm([{ text: leaked }]);
    const onDelta = vi.fn();

    await expect(
      agentTurn(toolProfile([], false), [], '查一下', '', llm, { hooks: { onDelta } }),
    ).rejects.toThrow('模型未能生成有效答案');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('caps tool rounds, then forces a text finish with tools disabled', async () => {
    const tool = fakeTool('loop', async () => ({ observation: '{}' }));
    const llm = vi.fn<AgentLlm>(async (_messages, tools) =>
      tools.length
        ? { toolCalls: [{ id: 'x', name: 'loop', args: '{}' }] }
        : { text: '到此为止。' },
    );
    const result = await agentTurn(toolProfile([tool], false), [], '一直查', '', llm);
    expect(result.toolTrace).toHaveLength(8); // MAX_TOOL_ROUNDS
    expect(result.attempts).toBe(9); // 8 tool rounds + 1 forced finish
    expect(result.reply).toBe('到此为止。');
    // The forced-finish call got no tools and saw the cap notice.
    const lastCallArgs = llm.mock.calls[8];
    expect(lastCallArgs[1]).toEqual([]);
    expect(
      lastCallArgs[0].some(
        (message) => message.role === 'user' && message.content.includes('round limit reached'),
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

  it('collects universe artifacts side-produced by tools', async () => {
    const spec = {
      version: 1 as const,
      source: { kind: 'equity_market' as const, market: 'CN' as const },
      asOf: { kind: 'latest_available' as const },
      eligibility: {
        minimumListedDays: 0,
        suspension: 'exclude' as const,
        riskWarning: 'include' as const,
      },
      predicates: [],
      missing: 'exclude' as const,
      select: [{ measure: 'equity.close', measureVersion: 1 as const }],
    };
    const tool = fakeTool('runUniverse', async () => ({
      observation: '{"total":1}',
      rows: 1,
      universe: { title: '全市场快照', spec },
    }));
    const llm = scriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'runUniverse', args: '{}' }] },
      { text: '筛好了,见卡片。' },
    ]);
    const result = await agentTurn(toolProfile([tool], false), [], '筛一下', '', llm);
    expect(result.universes).toEqual([{ title: '全市场快照', spec }]);
  });

  it('collects Cell change proposals as durable review parts', async () => {
    const proposal = {
      version: 1 as const,
      id: 'proposal-1',
      documentId: 'document-1',
      title: 'Add rolling volatility',
      summary: 'Add one Python cell without running it.',
      status: 'pending' as const,
      expectedDocumentUpdatedAt: '2026-08-18T08:00:00.000Z',
      expectedDocumentContentRevision: 1,
      operations: [
        {
          operationId: 'operation-1',
          cellId: 'cell-new',
          kind: 'create' as const,
          cellKind: 'python' as const,
          position: 1,
          beforeSource: '' as const,
          afterSource: 'vol = returns.rolling(20).std()',
          addedLines: 1,
          removedLines: 0,
          afterDefinitions: ['vol'],
          afterReferences: ['returns'],
        },
      ],
      createdAt: '2026-08-18T08:00:00.000Z',
    };
    const tool = fakeTool('proposeResearchCellChanges', async () => ({
      observation: '{"status":"pending"}',
      researchCellChange: proposal,
    }));
    const llm = scriptedLlm([
      { toolCalls: [{ id: 'c1', name: tool.name, args: '{}' }] },
      { text: 'I prepared a change for review.' },
    ]);

    const result = await agentTurn(toolProfile([tool], false), [], 'Add volatility', '', llm);

    expect(result.researchCellChanges).toEqual([proposal]);
    expect(turnParts(result)).toContainEqual({ type: 'research_cell_change', proposal });
  });

  it('keeps clarification as the only durable outcome when a provider also drafts changes', async () => {
    const proposal = {
      version: 1 as const,
      id: 'proposal-1',
      documentId: 'document-1',
      title: 'Draft',
      summary: 'Draft before the data identity was confirmed.',
      status: 'pending' as const,
      expectedDocumentUpdatedAt: '2026-08-18T08:00:00.000Z',
      expectedDocumentContentRevision: 1,
      operations: [],
      createdAt: '2026-08-18T08:00:00.000Z',
    };
    const clarification = {
      version: 1 as const,
      id: 'clarification-1',
      documentId: 'document-1',
      title: 'Choose the data identity',
      status: 'pending' as const,
      questions: [
        {
          id: 'question-1',
          prompt: 'Which proxy?',
          selectionMode: 'single' as const,
          allowCustom: true,
          options: [
            {
              id: 'keep_gap',
              kind: 'keep_gap' as const,
              labelZh: '不使用代理',
              labelEn: 'Do not substitute',
              descriptionZh: '保留缺口',
              descriptionEn: 'Keep the gap',
            },
          ],
        },
      ],
      createdAt: '2026-08-18T08:00:00.000Z',
    };
    const proposalTool = fakeTool('proposeResearchCellChanges', async () => ({
      observation: '{"status":"pending"}',
      researchCellChange: proposal,
    }));
    const clarificationTool = fakeTool('requestResearchClarification', async () => ({
      observation: '{"status":"pending"}',
      researchClarification: clarification,
    }));
    const llm = scriptedLlm([
      {
        toolCalls: [
          { id: 'p1', name: proposalTool.name, args: '{}' },
          { id: 'q1', name: clarificationTool.name, args: '{}' },
          { id: 'p2', name: proposalTool.name, args: '{}' },
        ],
      },
      { text: 'Please confirm the data identity.' },
    ]);

    const result = await agentTurn(
      toolProfile([proposalTool, clarificationTool], false),
      [],
      'Analyze it',
      '',
      llm,
    );

    expect(result.researchCellChanges).toEqual([]);
    expect(result.researchClarifications).toEqual([clarification]);
    expect(result.toolTrace).toEqual([
      expect.objectContaining({ name: 'proposeResearchCellChanges', ok: true }),
      expect.objectContaining({ name: 'requestResearchClarification', ok: true }),
      expect.objectContaining({ name: 'proposeResearchCellChanges', ok: false }),
    ]);
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
    // The mock offers raw deltas like chatTools; core buffers them until protocol validation passes.
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
      expect.objectContaining({
        modelCall: 1,
        toolCallId: 'c1',
        arguments: '{}',
        observation: '{}',
      }),
    );
    expect(hooks.onRepair).toHaveBeenCalledWith(1, '编译失败');
    // Only the protocol-safe produce reply is published; compile-repair output stays silent.
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
