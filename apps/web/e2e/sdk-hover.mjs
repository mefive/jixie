import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// SDK hover quality (ROADMAP 4.3-C): hovering a ctx.* member in the lab editor must show the
// TypeScript QuickInfo (signature + localized JSDoc from the ambient SDK dts) MERGED with the 📖
// doc link — not a bare link tooltip (the old link provider used to replace the rich hover).
// Uses the dev-only window.__monaco hook for deterministic cursor placement.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  await page.goto(`${BASE}/lab`, { waitUntil: 'domcontentloaded' });
  await page.getByText('或直接写代码').click();
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(4500);

  // Insert a real member usage inside onBar's body, then show the hover at exact offsets.
  await page.evaluate(() => {
    const monaco = window.__monaco;
    const model = monaco.editor.getModels()[0];
    const anchor = model.getPositionAt(model.getValue().indexOf('  },'));
    model.applyEdits([
      {
        range: {
          startLineNumber: anchor.lineNumber,
          startColumn: 1,
          endLineNumber: anchor.lineNumber,
          endColumn: 1,
        },
        text: '    const names = ctx.universe();\n',
      },
    ]);
  });
  await page.waitForTimeout(3000);

  const hoverAt = async (needle, into) => {
    await page.evaluate(
      ({ needle, into }) => {
        const monaco = window.__monaco;
        const model = monaco.editor.getModels()[0];
        const editor = monaco.editor.getEditors()[0];
        const position = model.getPositionAt(model.getValue().indexOf(needle) + into);
        editor.setPosition(position);
        editor.revealPositionInCenter(position);
        editor.focus();
        editor.trigger('e2e', 'editor.action.showHover', {});
      },
      { needle, into },
    );
    await page.waitForTimeout(2200);
    const text = await page
      .locator('.monaco-hover:visible')
      .first()
      .innerText()
      .catch(() => '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return text;
  };

  const universeHover = await hoverAt('ctx.universe', 6);
  if (
    !universeHover.includes('StrategyCtx') ||
    !universeHover.includes('.universe(indexCode?: string): Promise<Universe>')
  ) {
    throw new Error(`hover lost the TS QuickInfo signature: ${JSON.stringify(universeHover)}`);
  }
  if (!/链式选股入口|chainable universe/.test(universeHover)) {
    throw new Error(`hover lost the localized SDK doc: ${JSON.stringify(universeHover)}`);
  }
  if (!universeHover.includes('SDK 文档')) {
    throw new Error(`hover lost the doc link: ${JSON.stringify(universeHover)}`);
  }

  const defineHover = await hoverAt('defineStrategy({', 3);
  if (!defineHover.includes('defineStrategy(')) {
    throw new Error(`defineStrategy hover missing: ${JSON.stringify(defineHover)}`);
  }

  // Screenshot with the universe hover open for acceptance.
  await page.evaluate(() => {
    const monaco = window.__monaco;
    const model = monaco.editor.getModels()[0];
    const editor = monaco.editor.getEditors()[0];
    const position = model.getPositionAt(model.getValue().indexOf('ctx.universe') + 6);
    editor.setPosition(position);
    editor.focus();
    editor.trigger('e2e', 'editor.action.showHover', {});
  });
  await page.locator('.monaco-hover:visible').first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}7r-sdk-hover.png` });
  console.log('[sdk-hover-e2e] merged hover ok');
} finally {
  await context.close();
  await browser.close();
}
