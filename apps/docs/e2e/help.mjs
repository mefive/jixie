import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

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

  await page.goto(`${BASE}/lab`, { waitUntil: 'domcontentloaded' });
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
    (await page.locator('.jx-help-homeManualCard').count()) !== 10
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

  await page.goto(`${BASE}/docs/help/learning/cgb-curve-daily-signal`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('heading', { level: 1, name: '国债曲线到每日信号：证据、回测与部署' })
    .waitFor();
  if (
    (await page.locator('.jx-help-codeBlock').count()) < 3 ||
    (await page.locator('.jx-help-markdown table').count()) < 3 ||
    (await page.locator('.jx-help-figure').count()) !== 4 ||
    (await page.getByText('-1.918', { exact: true }).count()) < 1 ||
    (await page.getByRole('heading', { level: 2, name: '完成检查' }).count()) !== 1 ||
    (await page.locator('.jx-help-nav .jx-help-navLink--active').textContent()) !==
      '国债曲线到每日信号：证据、回测与部署'
  ) {
    throw new Error(
      'CGB daily-signal learning path is missing evidence, screenshots, completion, or navigation',
    );
  }
  await page.screenshot({ path: `${SHOTS}17e-help-signal-learning-path.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', {
      level: 1,
      name: 'From the CGB curve to a daily signal: evidence, backtest, and deployment',
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

  await page.goto(`${BASE}/docs/help/getting-started/overview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: '产品可以做什么' }).waitFor();

  const articleHrefs = [
    ...new Set(
      await page
        .locator('.jx-help-navLink')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ),
  ].filter(Boolean);
  if (articleHrefs.length !== 97) {
    throw new Error(`expected 97 help articles, got ${articleHrefs.length}`);
  }
  for (const href of articleHrefs) {
    if (new URL(page.url()).pathname !== href) {
      await Promise.all([
        page.waitForURL((url) => url.pathname === href),
        page.locator(`.jx-help-navLink[href="${href}"]`).first().click(),
      ]);
    }
    await page.waitForFunction(
      (expectedHref) =>
        document.querySelector('.jx-help-navLink--active')?.getAttribute('href') === expectedHref,
      href,
    );
    await page.locator('.jx-help-markdown h1').waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.jx-help-figure img')].every((image) => image.complete),
    );
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
    if ((await page.locator('.jx-help-markdown p .jx-help-figure').count()) > 0) {
      throw new Error(`help image rendered inside a paragraph in ${href}`);
    }
    const unknownLinks = await page
      .locator('.jx-help-markdown a[href^="/docs/help/"]')
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

  await page.getByRole('link', { name: '让策略 Agent 先做快捷回测', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '让策略 Agent 先做快捷回测' }).waitFor();
  await page.getByRole('heading', { level: 2, name: '快捷回测不会做什么' }).waitFor();

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
  if ((await page.locator('.jx-help-figure').count()) !== 6) {
    throw new Error('parameter scan article does not render all six screenshots');
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

  await page.getByRole('link', { name: '报告历史和结果已过期', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '报告历史和结果已过期' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('factor report-history article does not render both screenshots');
  }

  await page.getByRole('link', { name: '运行前研究卡和探索变体', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '运行前研究卡和探索变体' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('factor research-card article does not render both screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 2) {
    throw new Error('factor research-card formulas did not render with KaTeX');
  }

  await page.getByRole('link', { name: '正式保留段和样本外结果', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '正式保留段和样本外结果' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 5) {
    throw new Error('factor holdout article does not render all five screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}12c-help-factor-holdout.png`,
  });

  await page.getByRole('link', { name: '因子相关性矩阵', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '因子相关性矩阵' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('factor correlation article does not render both screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 4) {
    throw new Error('factor correlation formulas did not render with KaTeX');
  }
  await page.getByText('EN', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: 'Factor correlation matrix' }).waitFor();
  await page.getByText('中文', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: '因子相关性矩阵' }).waitFor();

  await page.getByRole('link', { name: '新建和编辑多因子合成', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '新建和编辑多因子合成' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('factor-composite definition article does not render its screenshot');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('factor-composite formula did not render with KaTeX');
  }

  await page.getByRole('link', { name: '查看多因子合成报告', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看多因子合成报告' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('factor-composite report article does not render its screenshot');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}14a-help-factor-composite.png` });

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
  await page.getByRole('heading', { level: 1, name: '让因子 Agent 运行探索分析' }).waitFor();
  await page.getByRole('heading', { level: 2, name: 'Agent 不能做什么' }).waitFor();

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

  await page.getByRole('link', { name: '开始使用因子气象', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '开始使用因子气象' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('factor weather getting-started article does not render both screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}15a-help-factor-weather.png` });

  await page.getByRole('link', { name: '阅读因子气象卡片', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '阅读因子气象卡片' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('factor weather card article does not render its screenshot');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 2) {
    throw new Error('factor weather compound-return formula did not render with KaTeX');
  }
  await page.getByText('EN', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: 'Read Factor Weather cards' }).waitFor();
  await page.getByText('中文', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: '阅读因子气象卡片' }).waitFor();

  await page.getByRole('link', { name: '查看市场气象图', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看市场气象图' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('market weather overview article does not render both screenshots');
  }

  await page.getByRole('link', { name: '理解市场气象卡片', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '理解市场气象卡片' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('market weather card article does not render its screenshot');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('market weather heat formula did not render with KaTeX');
  }

  await page.getByRole('link', { name: '回放历史并查看卡片详情', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '回放历史并查看卡片详情' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('market weather playback article does not render both screenshots');
  }

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
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('percentile article does not render both screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('percentile formula did not render with KaTeX');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}15b-help-market-weather.png`,
  });

  await page.getByRole('link', { name: '部署回测策略', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '部署回测策略' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('strategy deployment article does not render all three screenshots');
  }

  await page.getByRole('link', { name: '生成今日信号', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '生成今日信号' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('signal generation article does not render both screenshots');
  }

  await page.getByRole('link', { name: '查看信号指令', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看信号指令' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('signal instruction article does not render both screenshots');
  }

  await page.getByRole('link', { name: '记录实际成交并比较执行偏差', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '记录实际成交并比较执行偏差' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 3) {
    throw new Error('execution-record article does not render all three screenshots');
  }
  if ((await page.locator('.jx-help-markdown .katex').count()) < 1) {
    throw new Error('execution-rate formula did not render with KaTeX');
  }

  await page.getByRole('link', { name: '使用和记录条件单', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '使用和记录条件单' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 1) {
    throw new Error('conditional-order article does not render its screenshot');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}14b-help-signal-execution.png` });

  await page.getByRole('link', { name: '查看历史并暂停上线', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '查看历史并暂停上线' }).waitFor();
  if ((await page.locator('.jx-help-figure').count()) !== 2) {
    throw new Error('signal history article does not render both screenshots');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${SHOTS}13b-help-signals.png`,
  });
  await page.getByText('EN', { exact: true }).last().click();
  await page
    .getByRole('heading', { level: 1, name: 'View history and pause a deployment' })
    .waitFor();
  await page.getByText('中文', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: '查看历史并暂停上线' }).waitFor();

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

  await page.goto(`${BASE}/docs/help/signals/read-signals`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('heading', { level: 1, name: 'Read signal instructions' }).waitFor();
  const signalPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (signalPageOverflow) {
    throw new Error('signal instruction page has horizontal overflow at 390px');
  }

  console.log(
    '[help-e2e] public docs, same-tab docs nav, product popup, no tutorial, image hover, articles, formulas, and narrow layout ok',
  );
} finally {
  await context.close();
  await browser.close();
}
