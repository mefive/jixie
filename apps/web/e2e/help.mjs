import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

try {
  await page.goto(`${BASE}/help/getting-started/first-screen`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '第一次完成选股' }).waitFor();
  if (page.url().includes('/login')) {
    throw new Error('public help page redirected to login');
  }
  const publicHeader = page.locator('.jx-publicDocsHeader');
  const publicBrand = publicHeader.locator('.jx-publicDocsHeader-brand');
  const workspaceEntry = publicHeader.locator('.jx-publicDocsHeader-workspaceLink');
  await publicHeader.getByRole('link', { name: '使用帮助', exact: true }).waitFor();
  if ((await publicBrand.getAttribute('href')) !== '/') {
    throw new Error('public docs logo does not point to the product root');
  }
  if (
    (await workspaceEntry.getAttribute('href')) !== '/' ||
    (await workspaceEntry.getAttribute('target'))
  ) {
    throw new Error('workspace entry must open the product root in the current tab');
  }
  if (
    (await publicHeader
      .getByRole('link', { name: '使用帮助', exact: true })
      .getAttribute('target')) ||
    (await publicHeader.getByRole('link', { name: 'SDK 文档', exact: true }).getAttribute('target'))
  ) {
    throw new Error('help and SDK header links must stay in the current tab');
  }
  if ((await page.getByRole('link', { name: '返回产品' }).count()) !== 0) {
    throw new Error('help page still renders the removed Back to product link');
  }
  const articleImage = page.locator('.jx-help-figure .ant-image').first();
  await articleImage.scrollIntoViewIfNeeded();
  await articleImage.hover();
  const imageCover = articleImage.locator('.ant-image-cover');
  if ((await imageCover.count()) > 0 && (await imageCover.isVisible())) {
    throw new Error('help image still renders a dark hover cover');
  }

  await page.evaluate(() => {
    window.__publicDocsSpaMarker = 'same-document';
  });
  await publicHeader.getByRole('link', { name: 'SDK 文档', exact: true }).click();
  await page.waitForURL('**/docs');
  await page.getByRole('heading', { level: 1, name: '策略 SDK' }).waitFor();
  if ((await page.evaluate(() => window.__publicDocsSpaMarker)) !== 'same-document') {
    throw new Error('help to SDK navigation performed a full-page reload');
  }
  if (page.url().includes('/login')) {
    throw new Error('public SDK page redirected to login');
  }
  const sdkHeader = page.locator('.jx-publicDocsHeader');
  if (
    (await sdkHeader.locator('.jx-publicDocsHeader-brand').getAttribute('href')) !== '/' ||
    (await sdkHeader.locator('.jx-publicDocsHeader-workspaceLink').getAttribute('href')) !== '/'
  ) {
    throw new Error('SDK header product entries do not point to the product root');
  }
  if (
    (await sdkHeader.getByRole('link', { name: '使用帮助', exact: true }).getAttribute('target')) ||
    (await sdkHeader.getByRole('link', { name: 'SDK 文档', exact: true }).getAttribute('target'))
  ) {
    throw new Error('SDK header links must stay in the current tab');
  }
  if ((await page.getByRole('link', { name: /教程/ }).count()) !== 0) {
    throw new Error('SDK page still renders a tutorial link');
  }
  await sdkHeader.getByRole('link', { name: '使用帮助', exact: true }).click();
  await page.waitForURL('**/help/getting-started/overview');
  if ((await page.evaluate(() => window.__publicDocsSpaMarker)) !== 'same-document') {
    throw new Error('SDK to help navigation performed a full-page reload');
  }

  await page.goto(`${BASE}/learn`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/help/getting-started/overview');

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
  const helpEntry = page.getByRole('link', { name: '使用帮助' });
  await helpEntry.waitFor();
  if ((await helpEntry.getAttribute('href')) !== '/help') {
    throw new Error('top navigation help entry does not point to /help');
  }
  if ((await helpEntry.getAttribute('target')) !== '_blank') {
    throw new Error('product help entry does not open in a new tab');
  }

  const [openedHelp] = await Promise.all([context.waitForEvent('page'), helpEntry.click()]);
  await openedHelp.waitForURL('**/help/getting-started/overview');
  await openedHelp.getByRole('heading', { level: 1, name: '产品可以做什么' }).waitFor();
  await openedHelp.close();

  await page.goto(`${BASE}/help/getting-started/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: '产品可以做什么' }).waitFor();

  const articleHrefs = [
    ...new Set(
      await page
        .locator('.jx-help-navLink')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ),
  ].filter(Boolean);
  if (articleHrefs.length !== 40) {
    throw new Error(`expected 40 help articles, got ${articleHrefs.length}`);
  }
  for (const href of articleHrefs) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.jx-help-markdown h1').waitFor();
    const brokenImages = await page
      .locator('.jx-help-figure img')
      .evaluateAll((images) =>
        images
          .filter((image) => !image.complete || image.naturalWidth === 0)
          .map((image) => image.getAttribute('src')),
      );
    if (brokenImages.length > 0) {
      throw new Error(`broken help images in ${href}: ${JSON.stringify(brokenImages)}`);
    }
    const unknownLinks = await page
      .locator('.jx-help-markdown a[href^="/help/"]')
      .evaluateAll(
        (links, knownHrefs) =>
          links
            .map((link) => link.getAttribute('href'))
            .filter((linkHref) => linkHref && !knownHrefs.includes(linkHref)),
        articleHrefs,
      );
    if (unknownLinks.length > 0) {
      throw new Error(`unknown help links in ${href}: ${JSON.stringify(unknownLinks)}`);
    }
  }

  await page.goto(`${BASE}/help/getting-started/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: '登录', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '登录' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('login article does not render all three screenshots');
  }
  await page.locator('.jx-help-figure .ant-image').first().click();
  await page.locator('.ant-image-preview-img').waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: '第一次完成选股', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '第一次完成选股' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}9a-help-first-screen-markdown.png`,
  });

  await page.getByRole('link', { name: '第一次运行回测', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '第一次运行回测' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 4) {
    throw new Error('first backtest article does not render all four screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}9b-help-first-backtest-markdown.png`,
  });
  await page.getByRole('link', { name: '为什么回测不等于未来收益', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '为什么回测不等于未来收益' }).waitFor();
  await page.getByRole('heading', { level: 2, name: '过度拟合' }).waitFor();

  await page.getByRole('link', { name: '按条件筛选并查看结果', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '按条件筛选并查看结果' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('screening result article does not render its screenshot');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}10a-help-screening-guide.png`,
  });

  await page.getByRole('link', { name: '切换复权和价格坐标', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '切换复权和价格坐标' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('stock adjustment article does not render its screenshot');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}10b-help-stock-adjustment-guide.png`,
  });

  await page.getByRole('link', { name: '设置回测参数', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '设置回测参数' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('backtest settings article does not render its screenshot');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}11a-help-backtest-settings-guide.png`,
  });

  await page.getByRole('link', { name: '用策略描述创建回测', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '用策略描述创建回测' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('strategy description article does not render both screenshots');
  }

  await page.getByRole('link', { name: '继续修改策略并重新运行', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '继续修改策略并重新运行' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('strategy revision article does not render both screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}11e-help-strategy-revision-guide.png`,
  });

  await page.getByRole('link', { name: '查看交易明细和成本', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看交易明细和成本' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('backtest trades article does not render both screenshots');
  }

  await page.getByRole('link', { name: '恢复运行任务和处理失败', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '恢复运行任务和处理失败' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('backtest reconnect and failure article does not render both screenshots');
  }

  await page.getByRole('link', { name: '比较多组策略参数', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '比较多组策略参数' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('parameter scan article does not render both screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}11b-help-parameter-scan-guide.png`,
  });

  await page.getByRole('link', { name: '运行 ETF 策略', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '运行 ETF 策略' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('ETF strategy article does not render both screenshots');
  }

  await page.getByRole('link', { name: '运行股指期货策略', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '运行股指期货策略' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('index futures article does not render its screenshot');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}11c-help-index-futures-guide.png`,
  });

  await page.getByRole('link', { name: '运行股票与期货混合策略', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '运行股票与期货混合策略' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('mixed stock and futures article does not render both screenshots');
  }

  await page.getByRole('link', { name: '因子研究能回答什么', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '因子研究能回答什么' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('factor research introduction does not render its screenshot');
  }

  await page.getByRole('link', { name: '第一次运行预设因子分析', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '第一次运行预设因子分析' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('first preset factor article does not render all three screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}11f-help-first-factor-guide.png`,
  });

  await page.getByRole('link', { name: '设置分析范围和样本处理', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '设置分析范围和样本处理' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('factor analysis settings article does not render its screenshot');
  }

  await page.getByRole('link', { name: '查看第一份因子分析结果', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看第一份因子分析结果' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('factor result article does not render both screenshots');
  }
  await page.getByRole('heading', { level: 2, name: '第一次需要看懂的指标' }).waitFor();

  await page.getByRole('link', { name: '分组收益和前瞻收益', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '分组收益和前瞻收益' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('decile-return article does not render its screenshot');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 10) {
    throw new Error('decile-return formulas did not render with KaTeX');
  }

  await page.getByRole('link', { name: 'Rank IC、ICIR 和 IC 衰减', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: 'Rank IC、ICIR 和 IC 衰减' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('Rank IC article does not render both screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 20) {
    throw new Error('Rank IC formulas did not render with KaTeX');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}12a-help-factor-formulas.png`,
  });

  await page.getByRole('link', { name: '换手、交易成本和费后收益', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '换手、交易成本和费后收益' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('turnover and cost article does not render both screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 10) {
    throw new Error('turnover and cost formulas did not render with KaTeX');
  }

  await page.getByRole('link', { name: '市值和行业中性化', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '市值和行业中性化' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('neutralization article does not render all three screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 10) {
    throw new Error('neutralization formulas did not render with KaTeX');
  }

  await page.getByRole('link', { name: '页面导航', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '页面导航' }).waitFor();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}8a-help-desktop.png`,
  });

  const sectionLink = page.locator('.jx-help-tocLink', { hasText: '切换显示语言' });
  await sectionLink.click();
  await page.waitForFunction(() => decodeURIComponent(window.location.hash) === '#切换显示语言');

  await page.getByText('EN', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: 'Page navigation' }).waitFor();
  await page.getByRole('link', { name: 'Open Screener' }).click();
  await page.waitForURL('**/screen');

  await page.goto(`${BASE}/help/getting-started/first-backtest`, {
    waitUntil: 'domcontentloaded',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { level: 1, name: 'Run your first backtest' }).waitFor();
  await page.locator('.jx-help-mobileNav').waitFor();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (hasHorizontalOverflow) {
    throw new Error('help page has horizontal overflow at 390px');
  }

  await page.screenshot({
    path: `${SHOTS}8b-help-mobile.png`,
    fullPage: true,
  });

  await page.goto(`${BASE}/help/factors/rank-ic-icir`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: 'Rank IC, ICIR, and IC decay' }).waitFor();
  await page.locator('.jx-help-markdown .katex').first().waitFor();
  const formulaPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (formulaPageOverflow) {
    throw new Error('factor formula page has horizontal overflow at 390px');
  }
  await page.screenshot({
    path: `${SHOTS}12b-help-factor-formulas-mobile.png`,
    fullPage: true,
  });

  console.log(
    '[help-e2e] public docs, same-tab docs nav, product popup, no tutorial, image hover, articles, formulas, and narrow layout ok',
  );
} finally {
  await context.close();
  await browser.close();
}
