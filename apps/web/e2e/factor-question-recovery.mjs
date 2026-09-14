import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Frontend recovery regression, not an end-to-end product acceptance test.
// Transport failures are injected independently from ordinary user research questions.
// factor-questions.mjs covers the real Web/API/DB/Agent journey with a local model provider.
const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await context.addInitScript(() => localStorage.setItem('jx-locale', 'zh'));
let page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const createdAt = '2026-09-14T08:00:00.000Z';
const source = 'export default defineFactor({ name: "Fixture", compute: () => 1 });';
const spec = { version: 1, freq: 'month', start: '20200101', end: '20231231', neutral: 'none' };
const reports = ['report-a', 'report-b'].map((id, index) => ({
  id,
  factor: 'ep',
  status: 'done',
  phase: 'explore',
  createdAt,
  spec: { ...spec, start: index ? '20210101' : spec.start },
  researchSpec: { version: 1, analysisKind: 'cross_sectional', protocol: spec },
  factorCodeSnapshot: source,
  metrics: { rankIc: index ? 0.03 : 0.12 },
}));
const conversations = new Map();
const turns = new Map();
const subscriptions = new Map();
const requests = [];
let disconnectNext = false;
let loseNextResponse = false;
let nextStatus = 'done';
let delayedAuthorRequest;

function conversationFor(key) {
  if (!conversations.has(key)) {
    conversations.set(key, {
      conversationId: `conversation-${key}`,
      messages: [],
      activeTurnId: null,
    });
  }
  return conversations.get(key);
}
const json = (route, body, status = 200) => route.fulfill({ status, json: body });
const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
function events(turn) {
  const snapshot = { type: 'snapshot', text: '', trace: [] };
  const terminal =
    turn.status === 'done'
      ? {
          type: 'done',
          parts: [{ type: 'text', text: turn.answer }],
          code: '',
          changed: false,
          attempts: 1,
          toolTrace: [],
        }
      : turn.status === 'cancelled'
        ? { type: 'cancelled' }
        : { type: 'error', message: 'Fixture provider unavailable' };
  return frame(snapshot) + frame(terminal);
}
async function finish(id, status = 'done') {
  const turn = turns.get(id);
  turn.status = status;
  turn.message.turnStatus = status;
  if (status === 'error') {
    turn.message.turnError = 'Fixture provider unavailable';
  }
  const conversation = conversationFor(turn.key);
  conversation.activeTurnId = null;
  if (status === 'done') {
    conversation.messages.push({
      id: `answer-${id}`,
      role: 'assistant',
      parts: [{ type: 'text', text: turn.answer }],
      turnId: id,
      sequence: conversation.messages.length,
    });
  }
  await Promise.all(
    (subscriptions.get(id) ?? []).map((route) =>
      route.fulfill({ contentType: 'text/event-stream', body: events(turn) }).catch(() => {}),
    ),
  );
  subscriptions.set(id, []);
}
async function until(predicate) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Fixture state did not reach the expected condition');
    await delay(30);
  }
}

await context.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (path === '/api/auth/me') {
    return json(route, { user: { id: 'owner', email: 'fixture@example.invalid', name: null } });
  }
  if (path === '/api/maintenance/status') {
    return json(route, { active: false, retryAfterSeconds: 0 });
  }
  if (path === '/api/app/factors/catalog') {
    return json(route, [
      { key: 'ep', label: '盈利收益率', kind: 'fundamental', status: 'published', builtin: true },
      { key: 'mom', label: '动量', kind: 'price', status: 'published', builtin: true },
      { key: 'draft', label: 'Draft fixture', kind: 'custom', status: 'draft' },
    ]);
  }
  if (path === '/api/app/factors/research/window') {
    return json(route, {
      version: 1,
      months: 18,
      latestDate: '20260901',
      exploreEnd: '20250301',
      holdoutStart: '20250302',
      holdoutEnd: '20260901',
      checkedAt: createdAt,
    });
  }
  if (path === '/api/app/factors/research/summary') {
    const counts = {
      exploreRunCount: 2,
      exploreTestCount: 2,
      legacyRunCount: 0,
      holdoutCount: 0,
      revealedHoldoutCount: 0,
      expectedFalsePositivesAtFivePercent: 0.1,
    };
    return json(route, { global: counts, factor: counts });
  }
  if (path === '/api/app/factors/analysis-reports') {
    return json(route, { items: url.searchParams.get('factor') === 'ep' ? reports : [] });
  }
  const report = reports.find((item) => path === `/api/app/factors/analysis-reports/${item.id}`);
  if (report) {
    return json(route, report);
  }
  if (path === '/api/app/factors/draft') {
    return json(route, {
      id: 'draft',
      key: 'draft',
      name: 'Draft fixture',
      status: 'draft',
      owned: true,
      code: source,
      messages: [],
    });
  }
  if (path === '/api/app/factors/draft/agent/turns') {
    delayedAuthorRequest = route;
    return;
  }
  if (path === '/api/app/agent/turns/active') {
    return json(route, { turnId: null });
  }
  if (path === '/api/app/factors/ep' || path === '/api/app/factors/mom') {
    const key = path.split('/').at(-1);
    return json(route, {
      id: key,
      key,
      name: key,
      status: 'published',
      builtin: true,
      code: source,
      messages: [],
    });
  }
  const historyKey = path.match(/^\/api\/app\/factors\/([^/]+)\/questions$/)?.[1];
  if (historyKey) {
    const conversation = conversationFor(historyKey);
    const before = Number(url.searchParams.get('before') ?? Infinity);
    const previous = conversation.messages.filter((message) => message.sequence < before);
    const messages = previous.slice(-40);
    return json(route, {
      ...conversation,
      messages,
      nextBefore: previous.length > 40 ? messages[0].sequence : null,
    });
  }
  if (path === '/api/app/factors/questions' && request.method() === 'POST') {
    const input = request.postDataJSON();
    requests.push(input);
    const conversation = conversationFor(input.factorKey);
    const id = `turn-${requests.length}`;
    const selected = reports.find((item) => item.id === input.reportId);
    const message = {
      id: `question-${id}`,
      role: 'user',
      parts: [{ type: 'text', text: input.message }],
      sequence: conversation.messages.length,
      turnId: id,
      turnStatus: 'running',
      contextSnapshot: {
        version: 1,
        capturedAt: createdAt,
        factor: {
          key: input.factorKey,
          name: input.factorKey,
          kind: 'factor',
          analysisKind: 'cross_sectional',
          language: 'typescript',
          source,
          sourceHash: 'saved-source-hash',
        },
        report: selected
          ? {
              id: selected.id,
              summary: selected,
              contentHash: `${selected.id}-hash`,
              factorCodeSnapshot: source,
              factorCodeHash: 'report-source-hash',
              dataRevision: null,
            }
          : null,
      },
    };
    conversation.messages.push(message);
    conversation.activeTurnId = id;
    const answer = selected
      ? `所选报告的 Rank IC 均值为 ${selected.metrics.rankIc}。单个均值不足以判断稳定性，需要结合分期结果。`
      : '盈利收益率是正市盈率的倒数；这里解释定义，不推断因子的实测表现。';
    turns.set(id, { id, key: input.factorKey, status: 'running', message, answer });
    if (nextStatus === 'error') {
      nextStatus = 'done';
      await finish(id, 'error');
    }
    if (loseNextResponse) {
      loseNextResponse = false;
      return route.abort('failed');
    }
    return json(route, { conversationId: conversation.conversationId, turnId: id, message });
  }
  const streamId = path.match(/^\/api\/app\/agent\/turns\/([^/]+)\/stream$/)?.[1];
  if (streamId) {
    const turn = turns.get(streamId);
    if (!turn) {
      errors.push(`Unexpected stream after a factor switch: ${streamId}`);
      return json(route, { error: { code: 'NOT_FOUND', message: 'Unexpected stream' } }, 404);
    }
    if (disconnectNext) {
      disconnectNext = false;
      return route.fulfill({
        contentType: 'text/event-stream',
        body: frame({ type: 'snapshot', text: '', trace: [] }),
      });
    }
    if (turn.status !== 'running') {
      return route.fulfill({ contentType: 'text/event-stream', body: events(turn) });
    }
    subscriptions.set(streamId, [...(subscriptions.get(streamId) ?? []), route]);
    return;
  }
  const cancelId = path.match(/^\/api\/app\/agent\/turns\/([^/]+)\/cancel$/)?.[1];
  if (cancelId) {
    await finish(cancelId, 'cancelled');
    return json(route, { ok: true });
  }
  const detailId = path.match(/^\/api\/app\/agent\/turns\/([^/]+)$/)?.[1];
  if (detailId && turns.has(detailId)) {
    return json(route, {
      id: detailId,
      status: turns.get(detailId).status,
      model: 'fixture',
      startedAt: createdAt,
      trace: { version: 1, steps: [], truncated: false },
    });
  }
  errors.push(`Unexpected API request: ${request.method()} ${path}`);
  return json(route, { error: { code: 'NOT_FOUND', message: 'Unexpected fixture request' } }, 404);
});

async function ask(text) {
  const count = requests.length;
  const composer = page.locator('.jx-factor-chatBox');
  await composer.fill(text);
  await composer.press('Enter');
  await until(() => requests.length === count + 1);
  return `turn-${requests.length}`;
}
async function waitForAnswer(id) {
  await page
    .locator('.jx-factor-chatLog')
    .getByText(turns.get(id).answer, { exact: true })
    .last()
    .waitFor();
}

async function scenario(name, run) {
  await page.close();
  conversations.clear();
  turns.clear();
  subscriptions.clear();
  requests.length = 0;
  errors.length = 0;
  disconnectNext = false;
  loseNextResponse = false;
  nextStatus = 'done';
  delayedAuthorRequest = undefined;
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${base}/factors?factor=ep&report=report-a`, { waitUntil: 'domcontentloaded' });
    await page.locator('.jx-factorQuestion-toolbar').waitFor();
    await run();
    assert.deepEqual(errors, []);
    console.log(`[factor-question-recovery] ${name}: passed`);
  } catch (error) {
    await page
      .screenshot({ path: `${screenshots}factor-question-recovery-${name}-failure.png` })
      .catch(() => {});
    throw error;
  }
}

try {
  await scenario('refresh-during-answer', async () => {
    const question = '这份报告的 Rank IC 均值能说明什么？';
    const turnId = await ask(question);
    await until(() => subscriptions.get(turnId)?.length >= 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(() => subscriptions.get(turnId)?.length >= 2);
    await finish(turnId);
    await waitForAnswer(turnId);
    assert.equal(requests.length, 1);
    assert.equal(await page.getByText(question, { exact: true }).count(), 1);
    assert.equal(await page.locator('.jx-factor-bubble--assistant').count(), 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAnswer(turnId);
    assert.equal(await page.locator('.jx-factor-bubble--assistant').count(), 1);
  });

  await scenario('report-source-and-definition', async () => {
    const first = await ask('这份报告的结果应该怎样理解？');
    await finish(first);
    await waitForAnswer(first);
    const original = structuredClone(conversationFor('ep').messages[0].contextSnapshot);
    await page.locator('.jx-factor-historyTrigger').click();
    await page.locator('.jx-factor-historyItem').nth(1).click();
    await page.waitForURL('**report=report-b');
    const details = page.getByTestId('factor-question-context').first();
    await details.locator('summary').first().click();
    await details.getByText('本轮使用的报告与当前页面选择不同，回答仍保留原来的来源。').waitFor();
    await details.locator('summary').first().click();
    const second = await ask('这份较新的报告有什么不同？');
    assert.equal(requests.at(-1).reportId, 'report-b');
    await finish(second);
    await waitForAnswer(second);
    assert.deepEqual(conversationFor('ep').messages[0].contextSnapshot, original);
    await page.getByRole('radio', { name: '只问定义', exact: true }).check();
    const definition = await ask('先不看报告，解释一下盈利收益率的计算公式。');
    assert.equal(requests.at(-1).reportId, undefined);
    await finish(definition);
    await waitForAnswer(definition);
  });

  await scenario('factor-switch', async () => {
    const question = '盈利收益率和市盈率是什么关系？';
    const turnId = await ask(question);
    await until(() => subscriptions.get(turnId)?.length >= 1);
    await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
    await page.locator('.jx-factor-libItem', { hasText: '动量' }).click();
    await page.waitForURL('**factor=mom');
    await page.locator('.jx-factor-agent').getByRole('tab', { name: 'Agent', exact: true }).click();
    await finish(turnId);
    assert.equal(await page.getByText(question, { exact: true }).count(), 0);
    assert.equal(await page.getByTestId('factor-question-context').count(), 0);
    await page.goto(`${base}/factors?factor=ep&report=report-a`, { waitUntil: 'domcontentloaded' });
    await waitForAnswer(turnId);
    assert.equal(await page.getByText(question, { exact: true }).count(), 1);
  });

  await scenario('provider-failure-and-retry', async () => {
    const question = '报告里的 IC 是如何解释的？';
    nextStatus = 'error';
    await ask(question);
    await page.getByText('本轮回答失败，可重新提问；原问题与来源已保留。').waitFor();
    const retried = await ask('请再解释一下这份报告的 IC。');
    await finish(retried);
    await waitForAnswer(retried);
    assert.equal(await page.getByText(question, { exact: true }).count(), 1);
    assert.equal(await page.getByTestId('factor-question-context').count(), 2);
    assert.equal(await page.locator('.jx-factor-bubble--assistant').count(), 1);
    await page.getByText('EN', { exact: true }).click();
    await page
      .getByText('This answer failed. Ask again; the original question and source remain saved.')
      .waitFor();
    await page.getByText('中', { exact: true }).click();
  });

  await scenario('cancel-answer', async () => {
    const question = '这份报告是否足以说明因子稳定？';
    const turnId = await ask(question);
    await until(() => subscriptions.get(turnId)?.length >= 1);
    await page.locator('.jx-agentPending-stop').click();
    await page.getByText('本轮已取消，原问题与来源已保留。').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('本轮已取消，原问题与来源已保留。').waitFor();
    assert.equal(await page.getByText(question, { exact: true }).count(), 1);
    assert.equal(await page.locator('.jx-factor-bubble--assistant').count(), 0);
  });

  await scenario('connection-lost', async () => {
    disconnectNext = true;
    const turnId = await ask('为什么 IC 为正也不能直接说明能够盈利？');
    await page.getByText('连接已断开，回答可能仍在后台运行。请重新连接查看结果。').waitFor();
    await page.getByRole('button', { name: '刷新记录 / 重新连接' }).click();
    await until(() => subscriptions.get(turnId)?.length >= 1);
    await finish(turnId);
    await waitForAnswer(turnId);
    assert.equal(requests.length, 1);
    assert.equal(await page.locator('.jx-factor-bubble--assistant').count(), 1);
  });

  await scenario('submission-response-lost', async () => {
    const question = '这份报告的 IC 均值能与别的样本区间直接比较吗？';
    const recovered = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
    });
    loseNextResponse = true;
    const turnId = await ask(question);
    await page.locator('.jx-maintenanceGate').waitFor();
    await until(() => subscriptions.get(turnId)?.length >= 1);
    await finish(turnId);
    // The existing service-unavailable gate polls health and reloads after recovery.
    // Verify the answer is usable after that recovery, not merely behind the overlay.
    await recovered;
    await page.locator('.jx-factorQuestion-toolbar').waitFor();
    await page.locator('.jx-maintenanceGate').waitFor({ state: 'hidden' });
    await waitForAnswer(turnId);
    assert.equal(requests.length, 1);
    assert.equal(
      await page.locator('.jx-factor-chatLog').getByText(question, { exact: true }).count(),
      1,
    );
    assert.equal(await page.locator('.jx-factor-bubble--assistant').count(), 1);
  });

  await scenario('older-history', async () => {
    const first = await ask('盈利收益率为什么要排除非正的市盈率？');
    await finish(first);
    await waitForAnswer(first);
    const saved = conversationFor('ep');
    const sourceContext = saved.messages[0].contextSnapshot;
    const older = Array.from({ length: 42 }, (_, index) => [
      {
        id: `older-${index}`,
        role: 'user',
        parts: [{ type: 'text', text: `如何理解第 ${index + 1} 期的因子表现？` }],
        contextSnapshot: sourceContext,
        turnStatus: 'done',
      },
      {
        id: `older-answer-${index}`,
        role: 'assistant',
        parts: [{ type: 'text', text: '需要结合该期样本范围和分期结果理解。' }],
      },
    ]).flat();
    saved.messages = [...older, ...saved.messages].map((message, sequence) => ({
      ...message,
      sequence,
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '加载更早的问答' }).waitFor();
    assert.equal(await page.getByText('如何理解第 1 期的因子表现？', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '加载更早的问答' }).click();
    await page.locator('.jx-factor-bubble--user').nth(39).waitFor({ state: 'attached' });
    assert.equal(await page.locator('.jx-factor-bubble--user').count(), 40);
    assert.equal(await page.getByText('如何理解第 1 期的因子表现？', { exact: true }).count(), 0);
    // Eighty-six messages span three pages of forty; each click loads one older page.
    await page.getByRole('button', { name: '加载更早的问答' }).click();
    const earliest = page.getByText('如何理解第 1 期的因子表现？', { exact: true });
    await earliest.waitFor({ state: 'attached' });
    await earliest.scrollIntoViewIfNeeded();
    await earliest.waitFor();
    assert.equal(await page.locator('.jx-factor-bubble--user').count(), 43);
    assert.equal(await page.getByTestId('factor-question-context').count(), 43);
    await page.getByRole('button', { name: '加载更早的问答' }).waitFor({ state: 'hidden' });
  });

  await scenario('late-authoring-response', async () => {
    await page.goto(`${base}/factors?factor=draft`, { waitUntil: 'domcontentloaded' });
    const question = '帮我写一个比较 20 日和 60 日均线的因子。';
    await page.locator('.jx-factor-chatBox').fill(question);
    await page.locator('.jx-factor-chatBox').press('Enter');
    await until(() => !!delayedAuthorRequest);
    await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
    await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
    await page.locator('.jx-factor-agent').getByRole('tab', { name: 'Agent', exact: true }).click();
    await page.locator('.jx-factorQuestion-toolbar').waitFor();
    await json(delayedAuthorRequest, { turnId: 'late-authoring-turn' });
    assert.equal(await page.getByText(question, { exact: true }).count(), 0);
  });
} finally {
  await context.close();
  await browser.close();
}
