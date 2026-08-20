import { describe, expect, it, vi } from 'vitest';
import type { AgentLlm } from '../llm/agent-llm.js';
import type { ResearchExecutionV1 } from '@jixie/shared';
import {
  generateResearchFactorDraft,
  ResearchFactorHandoffRejectedError,
} from './research-factor-handoff.js';

const execution: ResearchExecutionV1 = {
  version: 1,
  id: 'execution-1',
  documentId: 'document-1',
  sequence: 2,
  title: 'ETF 动量研究',
  displayName: 'ETF 动量候选 · 基准版',
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
      source: '# 假设\nETF 过去 20 个交易日收益可能延续。',
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
      source: 'momentum = prices.iloc[-1] / prices.iloc[-21] - 1\nmomentum',
      revision: 1,
      definitions: ['momentum'],
      references: ['prices'],
      status: 'success',
      outputs: [{ type: 'value', value: 0.12 }],
    },
  ],
};

const validTimeSeriesCode = `from jixie import Factor, AssetFactorContext

factor = Factor.time_series(
    name="ETF 20日动量",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income", "commodity"],
    window=21,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 20)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None`;

const validCrossSectionalCode = `from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="低市净率")

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    return 1 / bar.pb if bar.pb is not None and bar.pb > 0 else None`;

describe('research Factor handoff', () => {
  it('classifies a frozen research signal and returns compile-validated Factor code', async () => {
    const classifier = vi.fn(async (_messages: Parameters<AgentLlm>[0]) =>
      JSON.stringify({
        decision: 'convertible',
        analysisKind: 'time_series',
        factorName: 'ETF 20日动量',
        factorKey: 'etf_momentum_20d',
        summary: '使用 ETF 过去 20 个交易日收益形成逐资产时间序列信号。',
        unresolvedItems: ['研究样本仅覆盖一个市场阶段。'],
        suggestedReport: {
          start: '20200101',
          end: '20241231',
          observationFrequency: 'daily',
          equityUniverse: null,
          minimumListingDays: null,
          excludeRiskWarnings: null,
          assets: ['510300.SH', '510300.SH'],
          hypothesis: 'ETF 过去 20 个交易日收益与未来收益正相关。',
          expectedDirection: 'positive',
        },
      }),
    );
    const codegen: AgentLlm = vi.fn(async () => ({
      text: `已按冻结研究重写为 Python Factor。\n\n\`\`\`python\n${validTimeSeriesCode}\n\`\`\``,
    }));

    const result = await generateResearchFactorDraft(execution, 'zh', {
      classifier,
      codegen,
    });

    expect(result).toMatchObject({
      analysisKind: 'time_series',
      language: 'python',
      factorName: 'ETF 20日动量',
      factorKeyBase: 'etf_momentum_20d',
      code: validTimeSeriesCode,
      summary: '使用 ETF 过去 20 个交易日收益形成逐资产时间序列信号。',
      suggestedReport: {
        version: 1,
        analysisKind: 'time_series',
        start: '20200101',
        end: '20241231',
        observationFrequency: 'daily',
        assets: ['510300.SH'],
        hypothesis: 'ETF 过去 20 个交易日收益与未来收益正相关。',
        expectedDirection: 'positive',
      },
    });
    expect(result.unresolvedItems).toContain('研究样本仅覆盖一个市场阶段。');
    expect(result.unresolvedItems).toContain(
      '候选尚未通过正式 FactorReport 验证方向、稳定性与冗余性。',
    );
    expect(result.messages).toHaveLength(2);
    expect(classifier.mock.calls[0]?.[0]?.[1]?.content).toContain('ETF 过去 20 个交易日收益');
  });

  it('rejects descriptive research before attempting code generation', async () => {
    const codegen = vi.fn<AgentLlm>();
    await expect(
      generateResearchFactorDraft(execution, 'zh', {
        classifier: async () =>
          JSON.stringify({
            decision: 'not_convertible',
            reason: '这份研究只有指数间回归，没有逐资产、逐时点的信号定义。',
          }),
        codegen,
      }),
    ).rejects.toThrow(ResearchFactorHandoffRejectedError);
    expect(codegen).not.toHaveBeenCalled();
  });

  it('keeps the Factor formula universe-neutral and returns CSI 300 as report input', async () => {
    const scopedExecution: ResearchExecutionV1 = {
      ...execution,
      cells: [
        execution.cells[0]!,
        {
          ...execution.cells[1]!,
          source: [
            'panel = data.panel(',
            '    "index:000300.SH",',
            '    start="20200101",',
            '    end="20241231",',
            '    frequency="month_end",',
            '    minimum_listed_days=365,',
            '    risk_warning="exclude",',
            ')',
            'panel["book_to_price"] = 1 / panel["pb"]',
          ].join('\n'),
        },
      ],
    };
    const result = await generateResearchFactorDraft(scopedExecution, 'zh', {
      classifier: async () =>
        JSON.stringify({
          decision: 'convertible',
          analysisKind: 'cross_sectional',
          factorName: '低市净率',
          factorKey: 'low_pb',
          summary: '使用正市净率倒数形成逐股票横截面信号。',
          unresolvedItems: [],
          suggestedReport: {
            start: '20200101',
            end: '20241231',
            observationFrequency: 'monthly',
            equityUniverse: '000300.SH',
            minimumListingDays: 365,
            excludeRiskWarnings: true,
            assets: [],
            hypothesis: '较高账面市值比预期对应较高未来收益。',
            expectedDirection: 'positive',
          },
        }),
      codegen: async () => ({ text: `\`\`\`python\n${validCrossSectionalCode}\n\`\`\`` }),
    });

    expect(result.code).toBe(validCrossSectionalCode);
    expect(result.code).not.toContain('000300.SH');
    expect(result.suggestedReport).toEqual({
      version: 1,
      analysisKind: 'cross_sectional',
      start: '20200101',
      end: '20241231',
      observationFrequency: 'monthly',
      equityUniverse: '000300.SH',
      minimumListingDays: 365,
      excludeRiskWarnings: true,
      hypothesis: '较高账面市值比预期对应较高未来收益。',
      expectedDirection: 'positive',
    });
  });

  it('turns malformed gatekeeper output into a user-facing rejection', async () => {
    await expect(
      generateResearchFactorDraft(execution, 'zh', {
        classifier: async () => 'not-json',
      }),
    ).rejects.toThrow('无法将这份研究识别为受支持的 Factor 草稿');
  });

  it('uses the existing compiler-repair loop before returning a draft', async () => {
    let call = 0;
    const codegen: AgentLlm = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { text: '先生成候选。\n```python\nfactor = object()\n```' }
        : { text: validTimeSeriesCode };
    });
    const result = await generateResearchFactorDraft(execution, 'zh', {
      classifier: async () =>
        JSON.stringify({
          decision: 'convertible',
          analysisKind: 'time_series',
          factorName: 'ETF 20日动量',
          factorKey: 'etf_momentum_20d',
          summary: '20 日价格动量。',
          unresolvedItems: [],
          suggestedReport: {
            start: null,
            end: null,
            observationFrequency: null,
            equityUniverse: null,
            minimumListingDays: null,
            excludeRiskWarnings: null,
            assets: [],
            hypothesis: null,
            expectedDirection: null,
          },
        }),
      codegen,
    });

    expect(result.code).toBe(validTimeSeriesCode);
    expect(codegen).toHaveBeenCalledTimes(2);
  });
});
