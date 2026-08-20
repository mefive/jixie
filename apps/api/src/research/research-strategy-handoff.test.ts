import { describe, expect, it, vi } from 'vitest';
import type { AgentLlm } from '../llm/agent-llm.js';
import type { ResearchExecutionV1 } from '@jixie/shared';
import {
  generateResearchStrategyDraft,
  ResearchStrategyHandoffRejectedError,
} from './research-strategy-handoff.js';

const execution: ResearchExecutionV1 = {
  version: 1,
  id: 'execution-1',
  documentId: 'document-1',
  sequence: 2,
  title: 'ETF 动量轮动研究',
  displayName: '主要 ETF 月度动量 · 基准版',
  contentRevision: 4,
  runtimeVersion: 'research-py-v1',
  status: 'success',
  sourceHash: 'source-hash',
  environmentFingerprint: 'environment-hash',
  cellCount: 2,
  executedCellCount: 2,
  tags: ['ETF', '动量'],
  promotedAt: '2026-08-19T10:00:00.000Z',
  startedAt: '2026-08-19T09:59:00.000Z',
  finishedAt: '2026-08-19T10:00:00.000Z',
  dag: [{ cellId: 'python-1', dependsOnCellIds: [] }],
  cells: [
    {
      version: 1,
      cellId: 'markdown-1',
      position: 0,
      kind: 'markdown',
      source: '# 规则\n在沪深300、黄金和5年国债 ETF 中按60日收益排序，每月选择前2只等权持有。',
      revision: 1,
      definitions: [],
      references: [],
      status: 'success',
      outputs: [],
    },
    {
      version: 1,
      cellId: 'python-1',
      position: 1,
      kind: 'python',
      source: 'momentum = prices.iloc[-1] / prices.iloc[-61] - 1\nmomentum',
      revision: 1,
      definitions: ['momentum'],
      references: ['prices'],
      status: 'success',
      outputs: [{ type: 'value', value: 0.12 }],
    },
  ],
};

const validPythonCode = `from jixie import Strategy

assets = ["510300.SH", "518880.SH", "511010.SH"]
last_period = ""
strategy = Strategy(name="主要ETF月度动量", params={"lookback": 61}, watch=assets)

@strategy.on_bar
def handle_bar(ctx):
    global last_period
    period = ctx.period("monthly")
    if period == last_period:
        return
    last_period = period
    ranked = []
    for code in assets:
        history = ctx.history(code, "close", ctx.params["lookback"])
        if len(history) == ctx.params["lookback"] and history[0] > 0:
            ranked.append((code, history[-1] / history[0] - 1))
    picks = [code for code, _ in sorted(ranked, key=lambda item: item[1], reverse=True)[:2]]
    ctx.equal_weight(picks) if len(picks) == 2 else ctx.set_holdings({})`;

describe('research Strategy handoff', () => {
  it('classifies a complete trading rule and returns validated Python Strategy code', async () => {
    const classifier = vi.fn(async (_messages: Parameters<AgentLlm>[0]) =>
      JSON.stringify({
        decision: 'direct_strategy',
        strategyName: '主要ETF月度动量',
        summary: '在三只主要 ETF 中按 60 日动量每月选择前两只等权持有。',
        unresolvedItems: ['样本只覆盖一个市场阶段。'],
      }),
    );
    const codegen: AgentLlm = vi.fn(async () => ({
      text: `已将封存规则写成 Python 策略草稿。\n\n\`\`\`python\n${validPythonCode}\n\`\`\``,
    }));
    const validate = vi.fn(async () => {});

    const result = await generateResearchStrategyDraft(execution, 'zh', {
      classifier,
      codegen,
      validate,
    });

    expect(result).toMatchObject({
      strategyName: '主要ETF月度动量',
      code: validPythonCode,
      summary: '在三只主要 ETF 中按 60 日动量每月选择前两只等权持有。',
    });
    expect(result.unresolvedItems).toContain('样本只覆盖一个市场阶段。');
    expect(result.unresolvedItems).toContain(
      '交接生成时未自动运行回测；需在 Strategy Lab 中显式运行并核对结果。',
    );
    expect(result.messages).toHaveLength(2);
    expect(validate).toHaveBeenCalledWith(validPythonCode);
    expect(classifier.mock.calls[0]?.[0]?.[1]?.content).toContain('每月选择前2只等权持有');
  });

  it('routes a signal-only study to Factor before code generation', async () => {
    const codegen = vi.fn<AgentLlm>();
    await expect(
      generateResearchStrategyDraft(execution, 'zh', {
        classifier: async () =>
          JSON.stringify({
            decision: 'factor_first',
            reason: '研究只有收益预测信号，没有组合构建和交易规则，请先进入 Factor 验证。',
          }),
        codegen,
      }),
    ).rejects.toThrow(ResearchStrategyHandoffRejectedError);
    expect(codegen).not.toHaveBeenCalled();
  });

  it('turns malformed gatekeeper output into a user-facing rejection', async () => {
    await expect(
      generateResearchStrategyDraft(execution, 'zh', {
        classifier: async () => 'not-json',
      }),
    ).rejects.toThrow('无法将这份研究识别为受支持的 Python Strategy 草稿');
  });

  it('uses the existing repair loop before returning a draft', async () => {
    let validationCalls = 0;
    const validate = vi.fn(async (code: string) => {
      validationCalls += 1;
      if (validationCalls === 1) {
        throw new Error('invalid Python strategy');
      }
      expect(code).toBe(validPythonCode);
    });
    let codegenCalls = 0;
    const codegen: AgentLlm = vi.fn(async () => {
      codegenCalls += 1;
      return codegenCalls === 1
        ? { text: '先生成候选。\n```python\nstrategy = nope\n```' }
        : { text: validPythonCode };
    });
    const result = await generateResearchStrategyDraft(execution, 'zh', {
      classifier: async () =>
        JSON.stringify({
          decision: 'direct_strategy',
          strategyName: '主要ETF月度动量',
          summary: '月度 ETF 动量轮动。',
          unresolvedItems: [],
        }),
      codegen,
      validate,
    });

    expect(result.code).toBe(validPythonCode);
    expect(codegen).toHaveBeenCalledTimes(2);
  });
});
