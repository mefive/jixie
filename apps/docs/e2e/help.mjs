import assert from 'node:assert/strict';
import { checkHelpContent } from './help-content.mjs';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const contentInventory = checkHelpContent();
console.log('[help-content]', contentInventory.summary);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
let publicDocsAuthRequests = 0;
page.on('request', (request) => {
  if (request.url().endsWith('/api/auth/me')) {
    publicDocsAuthRequests += 1;
  }
});

try {
  await page.goto(`${BASE}/docs/help/getting-started/first-backtest`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '第一次运行回测' }).waitFor();
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
  await page.waitForURL('**/docs/sdk');
  await page.getByRole('heading', { level: 1, name: '策略 SDK' }).waitFor();
  if ((await page.evaluate(() => window.__publicDocsSpaMarker)) !== 'same-document') {
    throw new Error('help to SDK navigation performed a full-page reload');
  }
  if (page.url().includes('/login')) {
    throw new Error('public SDK page redirected to login');
  }
  if (publicDocsAuthRequests !== 0) {
    throw new Error(`public docs entry requested auth state ${publicDocsAuthRequests} time(s)`);
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
  await page.waitForURL('**/docs/help');
  await page.getByRole('heading', { level: 1, name: '从学习路径开始，也可以按页面查找' }).waitFor();
  if ((await page.evaluate(() => window.__publicDocsSpaMarker)) !== 'same-document') {
    throw new Error('SDK to help navigation performed a full-page reload');
  }

  await page.goto(`${BASE}/learn`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/docs/help');

  await page.goto(`${BASE}/help/getting-started/navigation?legacy=1#切换显示语言`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForURL(
    (url) =>
      url.pathname === '/docs/help/getting-started/navigation' &&
      url.search === '?legacy=1' &&
      decodeURIComponent(url.hash) === '#切换显示语言',
  );

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

  await page.goto(`${BASE}/strategy`, { waitUntil: 'domcontentloaded' });
  const helpEntry = page.getByRole('link', { name: '使用帮助' });
  await helpEntry.waitFor();
  if ((await helpEntry.getAttribute('href')) !== '/docs/help') {
    throw new Error('top navigation help entry does not point to /docs/help');
  }
  if ((await helpEntry.getAttribute('target')) !== '_blank') {
    throw new Error('product help entry does not open in a new tab');
  }

  const [openedHelp] = await Promise.all([context.waitForEvent('page'), helpEntry.click()]);
  await openedHelp.waitForURL('**/docs/help');
  await openedHelp
    .getByRole('heading', { level: 1, name: '从学习路径开始，也可以按页面查找' })
    .waitFor();
  await openedHelp.close();

  await page.goto(`${BASE}/docs/help`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: '从学习路径开始，也可以按页面查找' }).waitFor();
  if (
    (await page.locator('.jx-help-homeChoice').count()) !== 2 ||
    (await page.locator('.jx-help-homePath').count()) !== 6 ||
    (await page.locator('.jx-help-homeStep').count()) !== 30 ||
    (await page.locator('.jx-help-homeManualCard').count()) !== 7
  ) {
    throw new Error(
      'help landing does not render both entry modes, learning paths, and page groups',
    );
  }
  await page.screenshot({ path: `${SHOTS}17a-help-learning-home.png`, fullPage: true });

  await page.getByRole('link', { name: '开始描述性研究', exact: true }).click();
  await page
    .getByRole('heading', { level: 1, name: '可信跨市场研究：收益、汇率与相关性' })
    .waitFor();
  if (
    (await page.locator('.jx-help-codeBlock').count()) < 6 ||
    (await page.locator('.jx-help-figure').count()) < 3 ||
    (await page.getByText('0.6865', { exact: true }).count()) !== 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '可信跨市场研究：收益、汇率与相关性'
  ) {
    throw new Error(
      'trusted cross-market learning path is missing code, completion, or navigation',
    );
  }
  await page.screenshot({ path: `${SHOTS}17b-help-learning-path.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'Trustworthy cross-market research: returns, FX, and correlation',
    })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/learning/csi300-trend-strategy`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', { level: 1, name: '沪深 300 趋势策略：参数、成本与样本外' })
    .waitFor();
  if (
    (await page.locator('.jx-help-codeBlock').count()) < 2 ||
    (await page.locator('.jx-help-figure').count()) < 3 ||
    (await page.getByText('证据不足', { exact: true }).count()) < 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '沪深 300 趋势策略：参数、成本与样本外'
  ) {
    throw new Error('CSI 300 strategy learning path is missing code, completion, or navigation');
  }
  await page.screenshot({ path: `${SHOTS}17c-help-strategy-learning-path.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'CSI 300 trend strategy: parameters, costs, and out-of-sample evidence',
    })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/learning/csi300-value-factor`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', { level: 1, name: '沪深 300 价值因子：排序、IC、分层与样本外' })
    .waitFor();
  if (
    (await page.locator('.jx-help-markdown .katex').count()) < 2 ||
    (await page.locator('.jx-help-markdown table').count()) < 5 ||
    (await page.locator('.jx-help-figure').count()) < 3 ||
    (await page.getByText('2016-02-01', { exact: true }).count()) < 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '沪深 300 价值因子：排序、IC、分层与样本外'
  ) {
    throw new Error(
      'CSI 300 Factor learning path is missing formulas, tables, completion, or navigation',
    );
  }
  await page.screenshot({ path: `${SHOTS}17d-help-factor-learning-path.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'CSI 300 value factor: ranking, IC, portfolios, and holdout',
    })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/learning/stock-bond-allocation-risk`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', {
      level: 1,
      name: '股债配置与风险归因：贡献、相关性与压力情景',
    })
    .waitFor();
  if (
    (await page.locator('.jx-help-codeBlock').count()) < 3 ||
    (await page.locator('.jx-help-markdown table').count()) < 4 ||
    (await page.locator('.jx-help-figure').count()) !== 10 ||
    (await page.getByText('-8.25%', { exact: true }).count()) < 1 ||
    (await page.getByText('36.35%', { exact: true }).count()) < 1 ||
    (await page.getByText('12.41%', { exact: true }).count()) < 1 ||
    (await page.getByText('93.11%', { exact: true }).count()) < 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '股债配置与风险归因：贡献、相关性与压力情景'
  ) {
    throw new Error(
      'stock-bond allocation learning path is missing evidence, screenshots, completion, or navigation',
    );
  }
  await page.screenshot({ path: `${SHOTS}17f-help-allocation-learning-path.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'Stock-bond allocation and risk attribution: contributions, correlation, and stress scenarios',
    })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/learning/commodity-carry-holdout`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', {
      level: 1,
      name: '商品 Carry：期限结构、代理误差与样本外',
    })
    .waitFor();
  if (
    (await page.locator('.jx-help-codeBlock').count()) < 3 ||
    (await page.locator('.jx-help-markdown table').count()) < 5 ||
    (await page.locator('.jx-help-figure').count()) !== 4 ||
    (await page.getByText('-0.0471', { exact: true }).count()) < 1 ||
    (await page.getByText('0.520', { exact: true }).count()) < 1 ||
    (await page.getByText('25.43%', { exact: true }).count()) < 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '商品 Carry：期限结构、代理误差与样本外'
  ) {
    throw new Error(
      'commodity-carry learning path is missing evidence, screenshots, completion, or navigation',
    );
  }
  await page.screenshot({
    path: `${SHOTS}17g-help-commodity-carry-learning-path.png`,
    fullPage: true,
  });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'Commodity carry: term structure, proxy error, and holdout evidence',
    })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/learning/sales-yield-positive`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', {
      level: 1,
      name: '销售收益率：从正面 Holdout 到因子准入',
    })
    .waitFor();
  if (
    (await page.locator('.jx-help-codeBlock').count()) < 3 ||
    (await page.locator('.jx-help-markdown table').count()) < 4 ||
    (await page.locator('.jx-help-figure').count()) !== 2 ||
    (await page.getByText('0.03469', { exact: true }).count()) < 1 ||
    (await page.getByText('0.66%', { exact: true }).count()) < 1 ||
    (await page.getByText('-2.78%', { exact: true }).count()) < 1 ||
    (await page
      .getByText('abd0b11b68739b08a71e9348012aff14764fe688310575b9f93e3ce0cf81acca', {
        exact: true,
      })
      .count()) < 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '销售收益率：从正面 Holdout 到因子准入'
  ) {
    throw new Error(
      'sales-yield learning path is missing positive evidence, limitations, lineage, completion, or navigation',
    );
  }
  await page.screenshot({
    path: `${SHOTS}17h-help-sales-yield-positive-learning-path.png`,
    fullPage: true,
  });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'Sales yield: from a positive holdout to Factor admission',
    })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/getting-started/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: '产品可以做什么' }).waitFor();

  const articleHrefs = [
    ...new Set(
      await page
        .locator('.jx-help-navLink')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ),
  ].filter(Boolean);
  assert.deepEqual(
    [...articleHrefs].sort(),
    contentInventory.articles.map((article) => `/docs/help/${article.slug}`).sort(),
    'rendered navigation must include every registered article',
  );
  for (const locale of ['zh', 'en']) {
    await page
      .getByText(locale === 'zh' ? '中文' : 'EN', { exact: true })
      .last()
      .click();
    for (const article of contentInventory.articles) {
      const href = `/docs/help/${article.slug}`;
      const expected = article.locales[locale];
      if (new URL(page.url()).pathname !== href) {
        await Promise.all([
          page.waitForURL((url) => url.pathname === href),
          page.locator(`.jx-help-navLink[href="${href}"]`).first().click(),
        ]);
      }
      await page.getByRole('heading', { level: 1, name: expected.title, exact: true }).waitFor();
      await page.waitForFunction(
        (expectedHref) =>
          document.querySelector('.jx-help-navLink--active')?.getAttribute('href') === expectedHref,
        href,
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.jx-help-figure img')].every((image) => image.complete),
      );
      const renderedImages = await page.locator('.jx-help-figure img').evaluateAll((images) =>
        images.map((image) => ({
          src: new URL(image.src).pathname,
          alt: image.alt,
          loaded: image.complete && image.naturalWidth > 0,
        })),
      );
      assert.deepEqual(
        renderedImages,
        expected.figures.map((figure) => ({ ...figure, loaded: true })),
        `missing, incorrect, or broken figures: ${locale}/${article.slug}`,
      );
      assert.equal(
        await page.locator('.jx-help-markdown p .jx-help-figure').count(),
        0,
        `figure nested inside paragraph: ${locale}/${article.slug}`,
      );
      const renderedLinks = await page
        .locator('.jx-help-markdown a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      const helpLinks = (links) =>
        links
          .filter((href) => /^\/(?:docs\/)?help\//.test(href))
          .map((href) => href.replace(/^\/help\//, '/docs/help/'));
      assert.deepEqual(
        helpLinks(renderedLinks),
        helpLinks(expected.links),
        `rendered help links differ from source: ${locale}/${article.slug}`,
      );
      await checkCurrentWorkflow(article.slug, locale);
    }
    console.log(
      `[help-e2e] ${locale}: ${contentInventory.articles.length} articles, localized titles, figures, links, and workflows checked`,
    );
  }
  await page.getByText('中文', { exact: true }).last().click();

  await page.goto(`${BASE}/docs/help/backtesting/python-strategy`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '使用 Python 编写策略' }).waitFor();
  const codeTabs = page.getByTestId('help-code-tabs');
  await codeTabs.waitFor();
  if ((await page.locator('.jx-help-codeBlock .token').count()) < 10) {
    throw new Error('help code block did not render syntax-highlight tokens');
  }
  const codePageUrl = page.url();
  await codeTabs.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}16a-help-code-typescript.png` });
  await codeTabs.getByRole('tab', { name: 'Python' }).click();
  if (page.url() !== codePageUrl) {
    throw new Error('help code language switch changed the page URL');
  }
  if (
    (await codeTabs.locator('[data-code-language="python"]').count()) !== 1 ||
    !(await codeTabs.locator('code').textContent())?.includes('from jixie import Strategy')
  ) {
    throw new Error('help code language switch did not render the Python example');
  }
  if ((await codeTabs.locator('.token').count()) < 10) {
    throw new Error('Python help code did not render syntax-highlight tokens');
  }
  await page.screenshot({ path: `${SHOTS}16b-help-code-python.png` });

  await page.goto(`${BASE}/docs/help/backtesting/technical-indicators`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '在策略中使用技术指标' }).waitFor();
  if (
    (await page.getByTestId('help-code-tabs').count()) !== 1 ||
    (await page.locator('.jx-help-codeBlock .token').count()) < 10
  ) {
    throw new Error('technical-indicator guide did not render highlighted language tabs');
  }

  await page.goto(`${BASE}/docs/help/factors/robust-inference`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '阅读稳健截面推断' }).waitFor();
  if (
    (await page.locator('.jx-help-markdown .katex').count()) < 2 ||
    (await page.locator('.jx-help-figure').count()) !== 2
  ) {
    throw new Error('robust-inference guide did not render formulas and both E2E screenshots');
  }

  await page.goto(`${BASE}/docs/help/research/document-cells`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '建立研究文档和 Cell' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('research Cell guide did not render both E2E screenshots');
  }

  await page.goto(`${BASE}/docs/help/research/clarifications`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '回答研究口径确认' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('research clarification guide did not render both E2E screenshots');
  }

  await page.goto(`${BASE}/docs/help/research/yield-curves`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '读取美国国债收益率曲线' }).waitFor();
  if (
    (await page.locator('.jx-help-figure').count()) !== 2 ||
    (await page.locator('.jx-help-codeBlock .token').count()) < 10
  ) {
    throw new Error('yield-curve guide did not render screenshots and highlighted Python code');
  }

  await page.goto(`${BASE}/docs/help/research/python-runtime`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: '使用 Python 研究运行环境' }).waitFor();
  if (
    (await page.locator('.jx-help-figure').count()) !== 1 ||
    (await page.locator('.jx-help-markdown table').count()) !== 1 ||
    (await page.locator('.jx-help-codeBlock .token').count()) < 10
  ) {
    throw new Error(
      'Python runtime guide did not render its table, screenshot, and code highlight',
    );
  }

  await page.goto(`${BASE}/docs/help/getting-started/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: '登录', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '登录' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('login article does not render all three screenshots');
  }
  await page.locator('.jx-help-figure .ant-image').first().click();
  await page.locator('.ant-image-preview-img').waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: '第一次完成量化研究', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '第一次完成量化研究' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}9a-help-first-research-markdown.png`,
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

  await page.getByRole('link', { name: '怎样阅读两组分布比较', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '怎样阅读两组分布比较' }).waitFor();
  await page.getByRole('heading', { level: 2, name: '均值差和 Welch 区间' }).waitFor();
  if (
    (await page.locator('.jx-help-markdown .katex').count()) < 2 ||
    (await page.locator('.jx-help-codeBlock').count()) !== 1
  ) {
    throw new Error('distribution comparison guide did not render formulas and Python code');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}10a-help-distribution-comparison.png`,
  });

  await page.getByRole('link', { name: '怎样阅读事件研究', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '怎样阅读事件研究' }).waitFor();
  await page.getByRole('heading', { level: 2, name: 'AR、CAR 和 CAAR' }).waitFor();
  if (
    (await page.locator('.jx-help-markdown .katex').count()) < 3 ||
    (await page.locator('.jx-help-codeBlock').count()) !== 1
  ) {
    throw new Error('event-study guide did not render formulas and Python code');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}10c-help-event-study.png` });

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

  await page.getByRole('heading', { level: 2, name: 'Agent 与回测的分工' }).waitFor();
  if ((await page.locator('a[href*="backtesting/agent-quick-backtest"]').count()) !== 0) {
    throw new Error('help still links to the retired Agent backtest article');
  }

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
  if ((await page.locator('.jx-help-figure').count()) !== 7) {
    throw new Error(
      'parameter scan article must render six historical figures and the current control capture',
    );
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}11b-help-parameter-scan-guide.png`,
  });

  await page.getByRole('link', { name: '使用周线和月线条件', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '使用周线和月线条件' }).waitFor();
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('multi-timeframe formula did not render with KaTeX');
  }

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
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error(
      'first preset factor article does not render its workspace and progress screenshots',
    );
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

  await page.getByRole('link', { name: '市值中性化', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '市值中性化' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('neutralization article does not render all three screenshots');
  }
  await page.locator('.jx-help-markdown .katex').first().waitFor();
  const neutralizationFormulas = (
    await page.locator('.jx-help-markdown .katex').allTextContents()
  ).map((formula) => formula.replace(/[\s\u200b]/g, '').replaceAll('−', '-'));
  if (
    (await page.locator('.jx-help-markdown .katex-error').count()) !== 0 ||
    !neutralizationFormulas.some((formula) => formula.includes('ln(MV')) ||
    !neutralizationFormulas.some((formula) => formula.includes('0.08-0.06=0.02'))
  ) {
    throw new Error(
      `size regression or residual example did not render: ${JSON.stringify(neutralizationFormulas)}`,
    );
  }
  await page.screenshot({ path: `${SHOTS}industry-retirement-size-help-zh.png`, fullPage: true });

  await page.getByRole('link', { name: '保留报告和结果已过期', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '保留报告和结果已过期' }).waitFor();
  const reportHistoryImages = await page
    .locator('.jx-help-figure img')
    .evaluateAll((images) => images.map((image) => new URL(image.src).pathname));
  const expectedReportHistoryImages = [
    '/docs/images/help/zh/factors/factor-report-outdated-01.png',
    '/docs/images/help/zh/factors/report-question.png',
  ];
  if (JSON.stringify(reportHistoryImages) !== JSON.stringify(expectedReportHistoryImages)) {
    throw new Error('factor report-history article must render outdated and Q&A images');
  }

  if (await page.getByRole('link', { name: '运行前研究卡和探索变体', exact: true }).count()) {
    throw new Error('retired research-card guide remains discoverable');
  }
  if (await page.getByRole('link', { name: '正式保留段和样本外结果', exact: true }).count()) {
    throw new Error('retired holdout guide remains discoverable');
  }
  await page.screenshot({ path: `${SHOTS}12c-help-factor-report-history.png` });

  await page.getByRole('link', { name: '复制预设因子', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '复制预设因子' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('preset factor copy article does not render both screenshots');
  }

  await page.getByRole('link', { name: '新建和编辑自定义因子', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '新建和编辑自定义因子' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('custom factor article does not render all three screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('custom factor formula did not render with KaTeX');
  }

  await page.getByRole('link', { name: '让因子 Agent 运行探索分析', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '让因子 Agent 运行分析' }).waitFor();
  await page.getByRole('heading', { level: 2, name: '核对结果' }).waitFor();

  await page.getByRole('link', { name: '设置 Factor key', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '设置 Factor key' }).waitFor();

  await page.getByRole('link', { name: '在策略中使用自定义因子', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '在策略中使用自定义因子' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('factor strategy article does not render all three screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}12d-help-factor-custom.png`,
  });
  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', { level: 1, name: 'Use a custom factor in a strategy' })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: '在策略中使用自定义因子' }).waitFor();

  await page.getByRole('link', { name: '查看指数估值', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看指数估值' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('index valuation article does not render all three screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 2) {
    throw new Error('index valuation formulas did not render with KaTeX');
  }

  await page.getByRole('link', { name: '正确理解历史百分位', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '正确理解历史百分位' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('percentile article does not render its valuation screenshot');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('percentile formula did not render with KaTeX');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}15b-help-valuation-percentiles.png`,
  });

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
  await page.getByRole('link', { name: 'Open Research' }).click();
  await page.waitForURL('**/research');

  await page.goto(`${BASE}/docs/help`, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('heading', { level: 1, name: 'Follow a learning path or look up a product page' })
    .waitFor();
  const learningHomeOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (learningHomeOverflow) {
    throw new Error('learning home has horizontal overflow at 390px');
  }
  await page.screenshot({
    path: `${SHOTS}17c-help-learning-home-mobile.png`,
    fullPage: true,
  });

  await page.goto(`${BASE}/docs/help/getting-started/first-backtest`, {
    waitUntil: 'domcontentloaded',
  });
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

  const mobileNavigation = page.locator('.jx-help-mobileNav');
  await mobileNavigation.locator('summary').click();
  await mobileNavigation.locator('a[href="/docs/help/factors/publish-factor"]').click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'Publish a factor version',
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.jx-help-figure img')].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.locator('.jx-help-markdown').scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    false,
    'current English workflow must fit at 390px',
  );
  await page.screenshot({ path: `${SHOTS}18-help-current-workflow-mobile.png` });

  await page.goto(`${BASE}/docs/help/factors/rank-ic-icir`, {
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
    '[help-e2e] public docs, same-tab docs nav, product popup, bilingual corpus, current workflows, formulas, and narrow layout ok',
  );
} finally {
  await context.close();
  await browser.close();
}

async function checkCurrentWorkflow(slug, locale) {
  const workflows = {
    'backtesting/workspace': {
      heading: {
        zh: '当前草稿与最近结果',
        en: 'Current draft and latest result',
      },
      text: {
        zh: '旧报告链接会失效',
        en: 'Old report links become unavailable',
      },
      link: 'backtesting/results-overview',
    },
    'research/records': {
      heading: { zh: '搜索、归档和恢复', en: 'Search, archive, and restore' },
      text: { zh: '没有完整运行历史抽屉', en: 'the run-history drawer are retired' },
      link: 'research/run-control',
    },
    'research/data-catalog': {
      heading: { zh: '读取已有报告和观测', en: 'Read existing reports and observations' },
      text: { zh: 'results.backtest', en: 'results.backtest' },
      link: 'research/embedded-analysis',
    },
    'factors/publish-factor': {
      heading: { zh: '操作', en: 'Steps' },
      text: { zh: '不代表系统认可其投资价值', en: 'does not certify investment quality' },
      link: 'factors/factor-in-strategy',
    },
  };
  const expected = workflows[slug];
  if (!expected) {
    return;
  }
  await page
    .getByRole('heading', { level: 2, name: expected.heading[locale], exact: true })
    .waitFor();
  assert.ok(
    (await page.locator('.jx-help-markdown').innerText()).includes(expected.text[locale]),
    `missing workflow boundary: ${locale}/${slug}`,
  );
  await page.locator(`.jx-help-markdown a[href="/docs/help/${expected.link}"]`).first().waitFor();
  if (slug === 'factors/publish-factor') {
    await page.locator('.jx-help-markdown').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}18-help-current-workflow-${locale}.png` });
  }
  await page.locator(`.jx-help-markdown a[href="/docs/help/${expected.link}"]`).first().click();
  await page.waitForURL((url) => url.pathname === `/docs/help/${expected.link}`);
  const destination = contentInventory.articles.find((article) => article.slug === expected.link);
  await page
    .getByRole('heading', { level: 1, name: destination.locales[locale].title, exact: true })
    .waitFor();
}
