import assert from 'node:assert/strict';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  DEFAULT_BACKTEST_COST,
  type ChatMessage,
  type ResearchEmbeddedContextV1,
} from '@jixie/shared';

interface ModelMessage {
  role: string;
  content: string;
  tool_call_id?: string;
}

/** A controlled external model; every tool, SDK read and Python calculation uses production code. */
export async function embeddedModelResponse(context: Context) {
  const body = await context.req.json<{
    messages: ModelMessage[];
    tools?: { function: { name: string } }[];
  }>();
  const match = body.messages[0].content.match(/<embedded_context>([\s\S]*?)<\/embedded_context>/);
  assert.ok(match, 'The page must supply a server-resolved embedded context');
  const source = JSON.parse(match[1]) as ResearchEmbeddedContextV1;
  const english = source.host.id.endsWith('-en') || source.report?.id.endsWith('-en');
  const lastUser =
    body.messages.length -
    1 -
    [...body.messages].reverse().findIndex((message) => message.role === 'user');
  const observations = body.messages
    .slice(lastUser + 1)
    .filter((message) => message.role === 'tool');
  const reportMethod =
    source.host.type === 'factor' ? 'results.factor_report' : 'results.backtest_report';
  let calls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];
  let content = '';
  if (!observations.length) {
    assert.ok(body.tools?.some((tool) => tool.function.name === 'runEmbeddedAnalysis'));
    assert.ok(
      !body.tools?.some((tool) =>
        ['analyzeData', 'renderChart', 'renderComputedChart'].includes(tool.function.name),
      ),
    );
    calls = ['runtime.python', reportMethod, 'outputs'].map((text, index) => ({
      id: `catalog-${index}`,
      type: 'function',
      function: { name: 'searchResearchCatalog', arguments: JSON.stringify({ text }) },
    }));
  } else if (!observations.some((message) => message.tool_call_id === 'calculate')) {
    assert.ok(source.report, 'The current report must be explicitly bound by the real page');
    const metricLabel = english ? 'Metric' : '指标';
    const valueLabel = english ? 'Value' : '结果';
    const summaryExpression = `pd.DataFrame({${JSON.stringify(metricLabel)}: labels, ${JSON.stringify(valueLabel)}: values})`;
    let code = (
      source.host.type === 'factor'
        ? [
            'import pandas as pd',
            'import matplotlib.pyplot as plt',
            `report = results.factor_report(${JSON.stringify(source.report.id)})`,
            'buckets = pd.DataFrame(report["report"]["buckets"])',
            'plt.figure(figsize=(6, 3))',
            'plt.bar(buckets["bucket"] + 1, buckets["ann_return"] * 100)',
            'plt.xlabel("Group (low to high)")',
            'plt.ylabel("Annual return (%)")',
            'lower = float(buckets.loc[buckets["bucket"] == 0, "ann_return"].iloc[0])',
            'upper = float(buckets.loc[buckets["bucket"] == parameters["upper_bucket"], "ann_return"].iloc[0])',
            'spread = upper - lower',
            `labels = ${JSON.stringify(english ? ['Lowest group', 'Selected upper group', 'Return spread'] : ['最低组收益', '所选高组收益', '收益差'])}`,
            'values = [round(lower, 6), round(upper, 6), round(spread, 6)]',
          ]
        : [
            'import pandas as pd',
            'import matplotlib.pyplot as plt',
            `report = results.backtest_report(${JSON.stringify(source.report.id)})`,
            'nav = pd.DataFrame(report["report"]["nav"])',
            'plt.figure(figsize=(6, 3))',
            'plt.plot(nav["date"], nav["value"], marker="o")',
            'plt.xlabel("Date")',
            'plt.ylabel("Account equity")',
            'first = float(nav["value"].iloc[0])',
            'last = float(nav["value"].iloc[-1])',
            `labels = ${JSON.stringify(english ? ['Initial equity', 'Final equity', 'Change (decimal)'] : ['起始净值', '结束净值', '变化率（小数）'])}`,
            'values = [first, last, round(last / first - 1, 6)]',
          ]
    )
      .concat(summaryExpression)
      .join('\n');
    const references = JSON.parse(
      body.messages[0].content.match(
        /<selected_data_references>([\s\S]*?)<\/selected_data_references>/,
      )?.[1] ?? '[]',
    ) as Array<{ method: string; arguments: { report_id?: string } }>;
    const comparisonId = references.find(
      (reference) =>
        reference.method === 'research_factor_report' &&
        reference.arguments.report_id !== source.report!.id,
    )?.arguments.report_id;
    if (source.host.type === 'factor' && comparisonId) {
      code = code.replace(
        summaryExpression,
        [
          `comparison = results.factor_report(${JSON.stringify(comparisonId)})`,
          'other = pd.DataFrame(comparison["report"]["buckets"])',
          'other_spread = float(other.loc[other["bucket"] == 9, "ann_return"].iloc[0] - other.loc[other["bucket"] == 0, "ann_return"].iloc[0])',
          `labels = ${JSON.stringify(english ? ['Selected report spread', 'Referenced report spread', 'Difference'] : ['当前报告收益差', '引用报告收益差', '两者差值'])}`,
          'values = [round(spread, 6), round(other_spread, 6), round(spread - other_spread, 6)]',
          summaryExpression,
        ].join('\n'),
      );
    }
    calls = [
      {
        id: 'calculate',
        type: 'function',
        function: {
          name: 'runEmbeddedAnalysis',
          arguments: JSON.stringify({
            title: english ? 'Inspect the saved report' : '检查已保存报告',
            source: code,
            parameters: { upper_bucket: 9 },
            inputScope: english
              ? 'Selected and explicitly referenced reports only; decimal returns; no new evaluation or backtest.'
              : '仅使用所选及明确引用的报告；收益以小数表示；未重新运行因子检验或策略回测。',
          }),
        },
      },
    ];
  } else {
    const result = JSON.parse(
      observations.find((message) => message.tool_call_id === 'calculate')!.content,
    ) as {
      status: string;
      error?: string;
      outputs: { type: string; rows?: Record<string, unknown>[] }[];
    };
    assert.equal(result.status, 'success', result.error ?? JSON.stringify(result));
    const value = result.outputs.find((output) => output.type === 'table')?.rows?.at(-1)?.[
      english ? 'Value' : '结果'
    ];
    assert.equal(typeof value, 'number');
    content = english
      ? `The retained calculation returned **${value}**. The card contains the table, chart, Python and report source. This is an exploration of saved results, not new validation.`
      : `留存计算得到 **${value}**。表格、图表、Python 和报告来源都在分析卡片中。这是对已有结果的探索，不是一次新的正式验证。`;
  }
  return streamSSE(context, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              ...(content ? { content } : {}),
              ...(calls.length
                ? { tool_calls: calls.map((call, index) => ({ index, ...call })) }
                : {}),
            },
            finish_reason: null,
          },
        ],
      }),
    });
    await stream.writeSSE({
      data: JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
      }),
    });
    await stream.writeSSE({ data: '[DONE]' });
  });
}

const activeExecutions = new Set<Promise<void>>();
export async function settleEmbeddedExecutions() {
  await Promise.allSettled([...activeExecutions]);
}

export async function seedEmbeddedStrategies() {
  const { prisma } = await import('#infra/database/prisma.js');
  for (const locale of ['zh', 'en']) {
    const id = `embeddedstrategy${locale}`;
    const name = locale === 'zh' ? '净值检查示例' : 'Equity inspection example';
    const config = {
      name,
      language: 'typescript',
      code: 'export default { name: "Equity inspection", onBar() {} };',
      start: '20200101',
      end: '20200103',
      initialCash: 100,
      cost: DEFAULT_BACKTEST_COST,
    };
    const payload = {
      name,
      start: config.start,
      end: config.end,
      days: 3,
      initialCash: 100,
      finalValue: 110,
      totalReturn: 0.1,
      annReturn: 0.1,
      sharpe: 0.5,
      maxDrawdown: -0.1,
      trades: 0,
      tradeLog: [],
      nav: [
        { date: '20200101', value: 100 },
        { date: '20200102', value: 90 },
        { date: '20200103', value: 110 },
      ],
      benchReturn: 0,
      excessReturn: 0.1,
      informationRatio: 0,
      calmar: 1,
      winRate: 0,
      profitFactor: 0,
      turnover: 0,
      totalFees: 0,
      totalSlippage: 0,
      cost: DEFAULT_BACKTEST_COST,
      monthly: [],
    };
    await prisma.strategy.create({
      data: { id, userId: `question-reader-${locale}`, name, config, lastResult: payload },
    });
    await prisma.backtestReport.create({
      data: {
        id: `embedded-backtest-${locale}`,
        userId: `question-reader-${locale}`,
        strategyId: id,
        strategyName: name,
        legacyStatus: 'done',
        config,
        payload,
      },
    });
    // Persist representative pre-migration chart messages; a user reopens this saved conversation.
    const english = locale === 'en';
    const sql = "SELECT tradeDate, close FROM Daily WHERE tsCode='000001.SZ' ORDER BY tradeDate";
    const messages: ChatMessage[] = [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: english ? 'Show price and rebased price.' : '看一下价格和归一化价格。',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: english
              ? 'Price and rebased series from the saved query.'
              : '这是按所选查询绘制的价格与归一化序列。',
          },
          {
            type: 'chart',
            title: english ? 'Historical price' : '历史价格',
            chart: { kind: 'line', sql, x: 'tradeDate', series: [{ column: 'close' }] },
          },
          {
            type: 'chart',
            title: english ? 'Historical rebased price' : '历史归一化价格',
            chart: {
              source: 'compute',
              kind: 'line',
              queries: [{ name: 'prices', sql }],
              code: 'export default ({data, stats}) => data.prices.map(row => ({date: row.tradeDate, value: row.close / stats.mean(data.prices.map(item => item.close)) * 100}));',
              x: 'date',
              series: [{ column: 'value' }],
            },
          },
          {
            type: 'chart',
            title: english ? 'Unavailable historical sample' : '当前已无数据的历史样本',
            chart: {
              kind: 'line',
              sql: sql.replace('000001.SZ', '999999.SZ'),
              x: 'tradeDate',
              series: [{ column: 'close' }],
            },
          },
        ],
      },
    ];
    await prisma.strategy.create({
      data: {
        id: `legacycharts${locale}`,
        userId: `question-reader-${locale}`,
        name: english ? 'Saved chart conversation' : '已保存的图表对话',
        config,
        messages: JSON.parse(JSON.stringify(messages)),
      },
    });
  }
  const { JobScheduler } = await import('#jobs/scheduler.js');
  const { registerJobLifecycles } = await import('#jobs/register.js');
  const { JobService } = await import('#jobs/service.js');
  registerJobLifecycles();
  JobScheduler.initialize(async (jobId) => {
    const execution = JobService.execute(jobId);
    activeExecutions.add(execution);
    try {
      await execution;
    } finally {
      activeExecutions.delete(execution);
    }
  });
  JobScheduler.wake();
}
