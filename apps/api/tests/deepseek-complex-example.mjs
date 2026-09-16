// Manual live acceptance: real provider + Agent + embedded Python, using an isolated synthetic DB.
// Run from the repository root after building API: node apps/api/tests/deepseek-complex-example.mjs --live
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

assert.ok(
  process.argv.includes('--live'),
  'Pass --live to authorize paid synthetic requests within the stated limits.',
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// The local Python runner resolves its resources relative to the API workspace.
process.chdir(resolve(root, 'apps/api'));
const argument = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const maximumRequests = Number(argument('max-requests', '10'));
const maximumOutputTokens = Number(argument('max-output-tokens', '65536'));
const requestTimeout = 300_000;
const skipBasic = process.argv.includes('--skip-basic');
const analysisRequests = maximumRequests - (skipBasic ? 0 : 2);
assert.ok(Number.isInteger(maximumRequests) && maximumRequests >= 3 && maximumRequests <= 10);
assert.ok(
  Number.isInteger(maximumOutputTokens) && maximumOutputTokens > 0 && maximumOutputTokens <= 65536,
);
const output = resolve(root, argument('output', 'docs/reports/deepseek-v4-1-flash-example'));
const outputExists = await access(resolve(output, 'requests.json')).then(
  () => true,
  () => false,
);
assert.equal(outputExists, false, 'Keep prior attempts; select a fresh --output directory.');
const local = parseEnv(await readFile(resolve(root, 'apps/api/.env'), 'utf8'));
const configuredBase =
  process.env.DEEPSEEK_BASE_URL ?? local.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
assert.equal(
  new URL(configuredBase).origin,
  'https://api.deepseek.com',
  'Live acceptance requires the official endpoint.',
);
process.env.DEEPSEEK_API_KEY ||= local.DEEPSEEK_API_KEY;
assert.ok(process.env.DEEPSEEK_API_KEY, 'Missing DeepSeek API key');
const temporary = await mkdtemp('/tmp/jixie-deepseek-example-');
process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
delete process.env.DEEPSEEK_MODEL;
delete process.env.DEEPSEEK_AGENT_MODEL;
process.env.DEEPSEEK_AGENT_THINKING = 'true';
process.env.DEEPSEEK_REASONING_EFFORT = 'high';
process.env.DATABASE_URL = `file:${temporary}/example.db`;
process.env.JIXIE_PYTHON_LOCAL = '1';
process.env.JIXIE_PYTHON_EXECUTABLE ||= resolve(root, '.venv/research-py-v1/bin/python3');
await writeFile(`${temporary}/example.db`, '');
await mkdir(output, { recursive: true });

const load = (name) => import(pathToFileURL(resolve(root, 'apps/api/dist/src', name)).href);
const requests = [];
const toolsUsed = [];
const runs = [];
const exportedImages = new Map();
let traceWrites = Promise.resolve();
let database;
let runtime;
let passed = false;
let failure;
const progress = (event) => console.log(JSON.stringify(event));
const saveJson = (name, value) =>
  writeFile(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);

try {
  const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
  execFileSync(
    process.execPath,
    [
      requireApi.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve(root, 'apps/api/prisma/schema.prisma'),
    ],
    {
      env: process.env,
      stdio: 'pipe',
      timeout: 60_000,
    },
  );
  ({ prisma: database } = await load('infra/database/prisma.js'));
  ({ researchRuntimeManager: runtime } = await load('research/runtime/python-session.js'));
  await runtime.analyze('example-runtime-preflight', [{ id: 'preflight', source: 'value = 1' }]);
  runtime.close('example-runtime-preflight');
  const { chatTools, chatJson, chatText, deepseek } = await load('infra/llm/deepseek.js');
  const { agentTurn, turnParts } = await load('agent/core.js');
  const { strategyProfile } = await load('agent/profiles/strategy.js');
  const { withEmbeddedAnalysis } = await load('agent/profiles/embedded.js');
  const { captureEmbeddedContext } = await load('research/embedded/context.js');
  const { startPersistentTurn, persistEmbeddedAnalysisPart, finishPersistentTurn } =
    await load('agent/turns/records.js');
  const { claimQueuedJob } = await load('infra/jobs/records.js');
  const { executeEmbeddedRun } = await load('research/embedded/execute.js');
  const { completeEmbeddedRun } = await load('research/embedded/finish.js');
  const { getEmbeddedRun, getEmbeddedVersion } = await load('research/embedded/read.js');
  const { std, pearson, spearman, quantile, linearRegression } = await load('math/stats.js');

  const codes = ['000300.SH', '000852.SH', '000905.SH'];
  const missing = [new Set(), new Set([9, 33, 58]), new Set([17, 46, 71, 72])];
  const months = Array.from({ length: 85 }, (_, index) => {
    const date = new Date(Date.UTC(2018, 12 + index, 0));
    return date.toISOString().slice(0, 10).replaceAll('-', '');
  });
  const prices = [100, 150, 200];
  const fixture = [];
  for (let index = 0; index < months.length; index++) {
    let equityReturn = 0.006 + 0.035 * Math.sin(index * 0.67) + 0.017 * Math.cos(index * 1.17);
    if (index === 57) {
      equityReturn = -0.18;
    }
    if (index === 68) {
      equityReturn = 0.13;
    }
    const changes = [
      equityReturn,
      0.003 + (index <= 48 ? 0.8 : -0.55) * equityReturn + 0.011 * Math.sin(index * 1.77),
      0.003 +
        0.006 * Math.sin(index * 0.29) +
        0.003 * Math.cos(index * 0.93) +
        (index === 57 ? -0.03 : 0),
    ];
    codes.forEach((code, asset) => {
      if (index > 0) {
        prices[asset] *= 1 + changes[asset];
      }
      if (!missing[asset].has(index)) {
        fixture.push({ tsCode: code, tradeDate: months[index], close: prices[asset] });
      }
    });
  }
  await saveJson('synthetic-prices.json', fixture);
  await database.indexDaily.createMany({ data: fixture });
  await database.user.create({ data: { id: 'example-owner', email: 'synthetic@example.invalid' } });
  const code =
    'export default defineStrategy({ name: "Synthetic diversification example", watch: [], onBar(ctx) {} });';
  await database.strategy.create({
    data: {
      id: 'example-strategy',
      userId: 'example-owner',
      name: '合成数据 · 分散风险研究',
      config: { code, language: 'typescript' },
    },
  });

  // An independent TypeScript oracle computes from source prices; the model never receives it.
  const returns = codes.map((asset) => {
    const values = new Map(
      fixture.filter((row) => row.tsCode === asset).map((row) => [row.tradeDate, row.close]),
    );
    return months
      .slice(1)
      .map((date, index) =>
        values.has(date) && values.has(months[index])
          ? values.get(date) / values.get(months[index]) - 1
          : null,
      );
  });
  const expected = {
    assets: codes.map((asset, index) => {
      const values = returns[index].filter((value) => value !== null);
      return {
        asset,
        price_rows: 85 - missing[index].size,
        missing_months: missing[index].size,
        valid_returns: values.length,
        annual_vol: std(values) * Math.sqrt(12),
        q25: quantile(values, 0.25),
        q50: quantile(values, 0.5),
        q75: quantile(values, 0.75),
      };
    }),
    pairs: [1, 2].flatMap((asset) =>
      ['all', 'pre2023', 'post2023'].map((period) => {
        const rows = returns[0]
          .map((value, index) => ({ x: value, y: returns[asset][index], date: months[index + 1] }))
          .filter(
            ({ x, y, date }) =>
              x !== null &&
              y !== null &&
              (period === 'all' || (period === 'pre2023' ? date < '20230101' : date >= '20230101')),
          );
        const left = rows.map((row) => row.x),
          right = rows.map((row) => row.y);
        const fit = linearRegression(left, right);
        return {
          pair: `000300.SH/${codes[asset]}`,
          period,
          n: rows.length,
          pearson: pearson(left, right),
          spearman: spearman(left, right),
          alpha_monthly: fit.intercept,
          beta: fit.slope,
        };
      }),
    ),
  };
  await saveJson('independent-reference.json', expected);

  const question = `请用嵌入式 Cell 完成一次较复杂的分散风险研究，策略代码保持不变，不运行回测。
这是明确授权的合成数据演示，不是真实行情：A=000300.SH、B=000852.SH、C=000905.SH 只是隔离库里的三组月末价格代号，均为 CNY。请勿引用这些代码现实中的表现或替换其他资产。
读取 data.series 的 index 月末价格 level，2018-12-31 至 2025-12-31；2018-12 是计算首月收益的预热期，分析区间为 2019-01 至 2025-12。
我想知道：B 是否能稳定分散 A 的风险，还是全样本统计掩盖了阶段变化？C 与 A 的关系有什么不同？
请按完整自然月网格对齐价格，先保留缺失月份，再计算月收益；不能前向填充、补零或把跨越缺失月的变化当作单月收益。报告各资产价格行数、缺失月数、有效月收益数，以及各自样本的年化波动率（样本标准差 × sqrt(12)）和月收益 25/50/75 分位数（linear）。
对 A-B、A-C 分别做全样本、2023 年前、2023 年起的成对完整样本分析：样本数、Pearson、Spearman、含截距 OLS（y 为 B 或 C，x 为 A）的月 alpha 与 beta。
展示统计表与 Matplotlib 图：起点归一为 100 的价格曲线，以及连续 12 个自然月、要求 12 个完整成对观测的滚动相关性；缺失和窗口不足处断开，不把清理后的 12 行误称为 12 个月。图内用英文标签，中文解释结论与样本限制，不给出已验证的投资建议。
为核对原始精度，代码最后 print 一行 AUDIT_JSON= 加 JSON（不要提前四舍五入）：{"assets":[{"asset":"代码","price_rows":0,"missing_months":0,"valid_returns":0,"annual_vol":0,"q25":0,"q50":0,"q75":0}],"pairs":[{"pair":"000300.SH/对方代码","period":"all 或 pre2023 或 post2023","n":0,"pearson":0,"spearman":0,"alpha_monthly":0,"beta":0}]}。所有数字从真实执行计算，不在回复中臆造。`;
  await writeFile(resolve(output, 'question.txt'), question);
  const context = await captureEmbeddedContext(database, 'example-owner', {
    type: 'strategy',
    id: 'example-strategy',
  });
  const profile = withEmbeddedAnalysis(strategyProfile(), {
    userId: 'example-owner',
    source: context,
  });
  profile.system += `\n# Acceptance budget\nThis synthetic task has at most ${analysisRequests} completions. Batch independent required catalog lookups (runtime.python, data.series and outputs), submit one self-contained embedded analysis, then explain the executed result. Do not skip required catalog reads. Use Matplotlib for the requested figures. Do not emit an artifact code fence in your final answer.`;

  const client = deepseek();
  client.maxRetries = 0;
  client.timeout = requestTimeout;
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = async (body, options = {}) => {
    assert.ok(requests.length < maximumRequests, 'The live request budget is exhausted.');
    const record = {
      number: requests.length + 1,
      model: body.model,
      thinking: body.thinking?.type,
      maximumOutputTokens,
      timeoutMs: requestTimeout,
      stream: !!body.stream,
      startedAt: new Date().toISOString(),
    };
    requests.push(record);
    await saveJson('requests.json', requests);
    progress({ event: 'model_start', ...record });
    const deadline = AbortSignal.timeout(requestTimeout);
    const response = await originalCreate(
      { ...body, max_tokens: maximumOutputTokens },
      {
        ...options,
        maxRetries: 0,
        timeout: requestTimeout,
        signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
      },
    );
    const capture = async (message) => {
      record.returnedModel = message.model;
      if (message.usage) {
        record.usage = message.usage;
      }
      if (message.choices?.[0]?.finish_reason) {
        record.finishReason = message.choices[0].finish_reason;
      }
    };
    if (body.stream) {
      return (async function* () {
        for await (const chunk of response) {
          await capture(chunk);
          yield chunk;
        }
        record.finishedAt = new Date().toISOString();
        await saveJson('requests.json', requests);
        assert.notEqual(record.finishReason, 'length', 'Live output was truncated.');
        progress({ event: 'model_done', number: record.number, finishReason: record.finishReason });
      })();
    }
    await capture(response);
    record.finishedAt = new Date().toISOString();
    await saveJson('requests.json', requests);
    assert.notEqual(record.finishReason, 'length', 'Live output was truncated.');
    return response;
  };
  await startPersistentTurn({
    turnId: 'example-turn',
    userId: 'example-owner',
    entity: { kind: 'strategy', id: 'example-strategy' },
    history: [],
    message: question,
    model: 'deepseek-flash',
  });
  const result = await agentTurn(
    profile,
    [],
    question,
    code,
    async (...args) => {
      assert.ok(
        requests.length < analysisRequests,
        'The complex example used its completion budget.',
      );
      return chatTools(...args);
    },
    {
      locale: 'zh',
      hooks: {
        onToolDone(item, detail) {
          toolsUsed.push({ name: item.name, ok: item.ok, ...detail });
          traceWrites = traceWrites.then(() => saveJson('tool-trace.json', toolsUsed));
          progress({ event: 'tool', name: item.name, ok: item.ok });
        },
        async onEmbeddedAnalysis(part) {
          await persistEmbeddedAnalysisPart('example-turn', part);
          const run = await getEmbeddedRun(
            'example-owner',
            part.reference.analysisId,
            part.reference.runId,
          );
          await claimQueuedJob(run.jobId);
          const execution = await executeEmbeddedRun(run.runId, 'example-owner');
          await database.$transaction(async (transaction) => {
            await completeEmbeddedRun(transaction, execution);
            await transaction.job.update({
              where: { id: run.jobId },
              data: { status: 'done', finishedAt: new Date() },
            });
          });
          const completed = await getEmbeddedRun('example-owner', run.analysisId, run.runId);
          runs.push(completed);
          await saveJson('runs.json', runs);
          const images = [];
          for (const image of completed.outputs.filter((item) => item.type === 'image')) {
            const artifact = await database.researchArtifact.findUniqueOrThrow({
              where: { id: image.artifactId },
            });
            assert.equal(artifact.mimeType, 'image/png');
            const name = `run-${runs.length}-figure-${images.length + 1}.png`;
            await writeFile(resolve(output, name), artifact.data);
            images.push(name);
          }
          exportedImages.set(completed.runId, images);
          progress({
            event: 'python_done',
            status: completed.status,
            error: completed.error,
            outputs: completed.outputs.map((item) => item.type),
            retainedInputs: completed.inputs.length,
          });
        },
      },
    },
  );
  await saveJson('agent-result.json', result);
  await saveJson('tool-trace.json', toolsUsed);
  await writeFile(resolve(output, 'model-answer.md'), result.reply);
  await finishPersistentTurn({
    turnId: 'example-turn',
    status: 'done',
    parts: turnParts(result),
    trace: { version: 1, steps: [], truncated: false },
  });
  assert.equal(result.changed, false, 'Analysis must leave Strategy code unchanged.');
  assert.equal(result.error, undefined);
  assert.ok(runs.length > 0, 'The Agent must execute an embedded analysis.');
  assert.equal(runs.filter((item) => item.status === 'success').length, 1);
  const run = runs.at(-1);
  assert.equal(run.status, 'success', run.error ?? 'Embedded execution failed');
  assert.ok(runs.every((item) => item.analysisId === run.analysisId));
  assert.ok((await getEmbeddedVersion('example-owner', run.analysisId, run.versionId)).frozenAt);
  assert.equal(run.inputs.length, 3);
  assert.ok(
    run.inputs.every((item) => item.method === 'research_series' && item.status === 'received'),
  );
  await writeFile(resolve(output, 'model-cell.py'), run.source);
  await saveJson(
    'retained-inputs.json',
    await database.researchExecutionInput.findMany({
      where: { executionId: run.runId },
      select: { method: true, arguments: true, responseJson: true, sha256: true },
      orderBy: { sequence: 'asc' },
    }),
  );
  const stdout = run.outputs
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  const auditMatch = stdout.match(/AUDIT_JSON=(\{[^\n]+\})/);
  assert.ok(auditMatch, 'Missing full-precision audit output');
  const actual = JSON.parse(auditMatch[1]);
  const checks = [];
  for (const group of ['assets', 'pairs']) {
    assert.equal(actual[group].length, expected[group].length);
    for (const reference of expected[group]) {
      const observed = actual[group].find((row) =>
        group === 'assets'
          ? row.asset === reference.asset
          : row.pair === reference.pair && row.period === reference.period,
      );
      assert.ok(observed, 'Missing audit row');
      for (const [key, value] of Object.entries(reference)) {
        if (typeof value !== 'number') {
          assert.equal(observed[key], value);
          continue;
        }
        assert.equal(typeof observed[key], 'number');
        const difference = Math.abs(observed[key] - value);
        assert.ok(
          difference <= 1e-8 + Math.abs(value) * 1e-7,
          `${group}/${JSON.stringify(reference)}/${key}: independent check failed`,
        );
        checks.push({
          group,
          asset: reference.asset,
          pair: reference.pair,
          period: reference.period,
          metric: key,
          difference,
        });
      }
    }
  }
  await saveJson('numerical-checks.json', checks);
  const images = exportedImages.get(run.runId) ?? [];
  assert.ok(images.length > 0, 'The example must include an executed figure.');

  if (!skipBasic) {
    const json = await chatJson([
      { role: 'user', content: 'Return only a JSON object with synthetic=true and value=3.' },
    ]);
    assert.deepEqual(JSON.parse(json), { synthetic: true, value: 3 });
    const title = await chatText([
      {
        role: 'user',
        content: 'Return only this exact two-word synthetic title: Diversification Study',
      },
    ]);
    assert.equal(title.trim(), 'Diversification Study');
  }
  await saveJson('summary.json', {
    passed: true,
    model: 'deepseek-flash',
    modelCalls: requests.length,
    executionAttempts: runs.length,
    numericChecks: checks.length,
    frozen: true,
    retainedInputs: run.inputs.length,
    unchangedStrategy: !result.changed,
    images,
  });
  const report = `# DeepSeek V4.1 Flash：复杂嵌入式分析实测\n\n这是合成数据演示，不是真实市场结论。使用实际策略 Agent、目录、Research SDK 和本地 Python；没有运行回测或修改策略。\n\n实际调用 ${requests.length} 次，${checks.length} 个数值与独立 TypeScript 计算一致。成功版本已冻结，3 次 SDK 输入均留存于隔离运行；测试库清理，产物保存在此目录。\n\n## 模型给出的解释\n\n${result.reply}\n\n## 模型代码实际生成的图\n\n${images.map((name) => `![Model-generated figure](${name})`).join('\n\n')}\n\n## 可检查的材料\n\n- [用户问题](question.txt)\n- [模型生成的 Python](model-cell.py)\n- [合成原始价格](synthetic-prices.json)\n- [运行输出及输入元数据](runs.json)\n- [独立参考计算](independent-reference.json)\n- [逐项数值核对](numerical-checks.json)\n- [真实请求与 token 用量](requests.json)\n\n这是单个有方法约束的任务，不是新旧模型对照试验，也不代表普遍质量提升。图形、方法和文字结论还需要人工检查，数值核对不替代研究审查。\n`;
  await writeFile(resolve(output, 'README.md'), report);
  passed = true;
  progress({
    event: 'acceptance_passed',
    numericChecks: checks.length,
    requests: requests.length,
    output,
  });
} catch (error) {
  failure = {
    name: error?.name,
    message: error?.message?.replaceAll(process.env.DEEPSEEK_API_KEY, '[redacted]'),
    status: error?.status,
  };
  await saveJson('failure.json', { failure, requests });
  progress({ event: 'acceptance_failed', ...failure });
  process.exitCode = 1;
} finally {
  await traceWrites;
  if (database) {
    for (const document of await database.researchDocument.findMany({ select: { id: true } })) {
      runtime?.close(document.id);
    }
    await database.$disconnect();
  }
  await rm(temporary, { recursive: true, force: true });
  await saveJson('cleanup.json', {
    isolatedDatabaseRemoved: true,
    pythonSessionsClosed: true,
    passed,
    failure,
  });
}
