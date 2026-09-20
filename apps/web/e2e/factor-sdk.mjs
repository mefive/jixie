import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript(() => performance.setResourceTimingBufferSize(2000));
const errors = [];
const factorIds = [];
page.on('pageerror', (error) => errors.push(error.message));

async function request(path, method = 'GET', body) {
  const response = await page.request.fetch(`${base}${path}`, {
    method,
    ...(body ? { data: body } : {}),
  });
  assert.ok(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await request('/api/auth/dev/login', 'POST', { email: `factor-sdk-${Date.now()}@test.com` });

  for (const analysisKind of ['cross_sectional', 'time_series', 'panel']) {
    const source =
      analysisKind === 'cross_sectional'
        ? `export default defineFactor({
  name: 'SDK history', window: 3,
  compute(bar, ctx) {
    const closes = ctx.history(3);
    return bar.peTtm == null || closes.length < 3 ? null : closes[2] / closes[0] - 1;
  },
});`
        : `export default defineFactorV2({
  version: 2, name: 'SDK asset signal', analysisKind: '${analysisKind}',
  outputScope: 'asset', frequency: 'daily',
  inputs: ['etf.adjustedClose'], targetAssetClasses: ['equity'], window: 3,
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const prior = ctx.lag('etf.adjustedClose', 2);
    return current == null || prior == null ? null : current / prior - 1;
  },
});`;
    const factor = await request('/api/app/factors', 'POST', {
      key: `sdk_${analysisKind}_${Date.now().toString(36)}`,
      name: `SDK ${analysisKind}`,
      analysisKind,
      language: 'typescript',
      code: source,
    });
    factorIds.push(factor.id);
    await page.goto(`${base}/factors?factor=${factor.id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.jx-factor-code .monaco-editor').waitFor();
    // Inspect the exact Monaco instance already loaded by the development editor.
    // No product hook, extra ambient library or replacement language worker is installed.
    await page.evaluate(async () => {
      const resource = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/deps/monaco-editor.js'));
      if (!resource) {
        throw new Error('Factor SDK E2E requires the Vite development editor');
      }
      window.__factorSdkMonaco = await import(resource.name);
    });
    await page.waitForFunction(
      (id) =>
        window.__factorSdkMonaco.editor
          .getModels()
          .some(
            (model) =>
              model.uri.path === `/factors/${id}.ts` && model.getValue().includes('compute'),
          ),
      factor.id,
    );

    for (const locale of ['zh', 'en']) {
      await page
        .locator('.jx-topnav-user .ant-segmented-item')
        .nth(locale === 'zh' ? 0 : 1)
        .click();
      await page.waitForFunction((language) => document.documentElement.lang === language, locale);
      const info = await page.evaluate(
        async ({ id, kind }) => {
          const monaco = window.__factorSdkMonaco;
          const model = monaco.editor
            .getModels()
            .find((candidate) => candidate.uri.path === `/factors/${id}.ts`);
          const worker = await (await monaco.languages.typescript.getTypeScriptWorker())(model.uri);
          const token = kind === 'cross_sectional' ? 'bar.peTtm' : 'ctx.lag';
          const offset = model.getValue().indexOf(token) + 5;
          const hover = await worker.getQuickInfoAtPosition(model.uri.toString(), offset);
          const diagnostics = await worker.getSemanticDiagnostics(model.uri.toString());
          const editor = monaco.editor
            .getEditors()
            .find((candidate) => candidate.getModel() === model);
          editor.setPosition(model.getPositionAt(offset));
          editor.focus();
          editor.trigger('e2e', 'editor.action.showHover', {});
          return {
            diagnostics,
            signature: hover?.displayParts?.map((part) => part.text).join(''),
            docs: hover?.documentation?.map((part) => part.text).join(''),
          };
        },
        { id: factor.id, kind: analysisKind },
      );
      assert.deepEqual(info.diagnostics, []);
      assert.match(info.signature, analysisKind === 'cross_sectional' ? /peTtm/ : /lag/);
      if (analysisKind === 'cross_sectional') {
        assert.ok(info.docs.includes(locale === 'zh' ? '市盈率 TTM' : 'P/E (TTM)'), info.docs);
      }
      await page.locator('.monaco-hover:visible').first().waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${screenshots}factor-sdk-${analysisKind}-${locale}.png`,
        fullPage: true,
      });
      await page.keyboard.press('Escape');
    }

    // An actual editor change must survive autosave and server-side definition validation.
    const updated = `${source}\n// SDK authoring regression\n`;
    await page.evaluate(
      ({ id, code }) => {
        window.__factorSdkMonaco.editor
          .getModels()
          .find((model) => model.uri.path === `/factors/${id}.ts`)
          .setValue(code);
      },
      { id: factor.id, code: updated },
    );
    let saved;
    const deadline = Date.now() + 15_000;
    do {
      saved = await request(`/api/app/factors/${factor.id}`);
      if (saved.code === updated) {
        break;
      }
      await page.waitForTimeout(200);
    } while (Date.now() < deadline);
    assert.equal(saved.code, updated);
    assert.equal(saved.runtimeVersion, 'ts-v1');
  }
  assert.deepEqual(errors, []);
  console.log(
    '[factor-sdk-e2e] PASS three TS analysis kinds, bilingual hover/types, editor autosave; screenshots=6',
  );
} finally {
  for (const id of factorIds) {
    await page.request.delete(`${base}/api/app/factors/${id}`).catch(() => {});
  }
  await browser.close();
}
