import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

// Capture artifacts only: no model requests, financial calculations or assertion suite.
const base = process.env.E2E_BASE ?? 'http://127.0.0.1:5173';
if (
  process.env.HELP_CAPTURE_DISPOSABLE !== '1' ||
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname) ||
  !process.env.HELP_CAPTURE_CONFIG
) {
  throw new Error(
    'Use a disposable local API and provide HELP_CAPTURE_DISPOSABLE=1 and HELP_CAPTURE_CONFIG.',
  );
}
const config = JSON.parse(readFileSync(process.env.HELP_CAPTURE_CONFIG, 'utf8'));
const output = new URL('../../docs/public/images/help/', import.meta.url).pathname;
const raw = new URL('../acceptance/help-refresh/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true });
const pick = (locale, chinese, english) => (locale === 'zh' ? chinese : english);

try {
  for (const locale of ['zh', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const response = await context.request.post(`${base}/api/auth/dev/login`, {
      data: { email: config.email },
    });
    if (!response.ok()) {
      throw new Error(`Development login failed: ${response.status()}`);
    }
    await context.addInitScript((language) => localStorage.setItem('jx-locale', language), locale);
    let page = await context.newPage();
    const selector = (value) => page.locator(value).first();
    const button = (chinese, english) =>
      page.getByRole('button', { name: pick(locale, chinese, english), exact: true });
    const research = `/research?document=${encodeURIComponent(config.document)}`;
    const strategy = `/strategy?id=${encodeURIComponent(config.strategy)}`;
    const factor = `/factors?factor=${encodeURIComponent(config.factor)}`;
    const scenes = [
      {
        name: 'getting-started/first-backtest-01-prompt',
        route: '/strategy?new=1',
        ready: '.jx-strategy-heroInput',
        prepare: async () => {
          await page.getByText('TypeScript', { exact: true }).click();
          await selector('.jx-strategy-heroInput').fill(
            pick(
              locale,
              '每月第一个交易日买入100股贵州茅台',
              'Buy 100 shares of Kweichow Moutai on the first trading day of each month',
            ),
          );
        },
        marks: ['.jx-strategy-heroInput', '.jx-strategy-heroSend', '.jx-strategy-examples'],
      },
      {
        name: 'backtesting/workspace-01',
        route: strategy,
        ready: '.jx-strategy-metrics',
        marks: [
          '.jx-strategy-agentTabs',
          '.jx-strategy-code',
          '.jx-strategy-resultTabs',
          '.jx-strategy-dock',
        ],
      },
      {
        name: 'backtesting/run-settings-01',
        route: strategy,
        ready: '.jx-strategy-metrics',
        prepare: async () => {
          await selector('.jx-strategy-runEditBtn').click();
        },
        marks: [
          '.jx-strategy-runPanelField:nth-of-type(1)',
          '.jx-strategy-runPanelField:nth-of-type(4)',
          '.jx-strategy-runPanelField:nth-of-type(5)',
          '.jx-strategy-runPanelField:nth-of-type(2)',
          '.jx-strategy-runPanelField:nth-of-type(3)',
          '.jx-strategy-runBtn',
        ],
      },
      {
        name: 'backtesting/report-controls',
        route: strategy,
        ready: '.jx-strategy-metrics',
        marks: [
          '.jx-strategy-runConfig',
          '[data-testid="backtest-report-history"]',
          '[data-testid="backtest-report-compare-toggle"]',
          '[data-testid="backtest-report-open-research"]',
        ],
      },
      {
        name: 'research/new-research-01',
        route: '/research',
        ready: '.jx-research-startInput',
        prepare: async () => {
          await selector('.jx-research-startInput').fill(
            pick(
              locale,
              '比较沪深300与中证500的月收益，先明确区间和检验方法',
              'Compare monthly CSI 300 and CSI 500 returns; first clarify the period and statistical method',
            ),
          );
        },
        marks: ['.jx-research-startInput', '.jx-research-startSend', '.jx-research-sidebar'],
      },
      {
        name: 'research/document-cells-02',
        route: research,
        ready: '[data-testid="research-cell-python"]',
        marks: [
          '[data-testid="research-cell-markdown"]',
          '[data-testid="research-cell-python"]',
          '.jx-research-toolbar',
        ],
      },
      {
        name: 'research/document-list-current',
        route: '/research',
        ready: '[data-testid="research-document-search"]',
        prepare: async () => {
          await page.getByTestId('research-document-search').fill('300');
          await page.getByTestId(`research-document-menu-${config.document}`).click();
        },
        marks: ['[data-testid="research-document-search"]', '.ant-dropdown-menu'],
      },
      {
        name: 'research/document-list-archived',
        route: '/research',
        ready: '[data-testid="research-document-state"]',
        prepare: async () => {
          await page
            .getByTestId('research-document-state')
            .getByText(pick(locale, '已归档', 'Archived'), { exact: true })
            .click();
          await page.getByTestId(`research-document-menu-${config.archivedDocument}`).click();
        },
        marks: ['[data-testid="research-document-state"]', '.ant-dropdown-menu'],
      },
      ...[
        ['market', '市场数据', 'Market data'],
        ['datasets', '数据集', 'Datasets'],
        ['factor-reports', 'Factor 报告', 'Factor reports'],
        ['backtests', '回测报告', 'Backtests'],
      ].map(([name, chinese, english]) => ({
        name: `research/catalog-${name}`,
        route: research,
        ready: '[data-testid="research-cell-python"]',
        prepare: async () => {
          await page.getByTestId('research-open-data-catalog').click();
          await selector('.jx-researchDataCatalog-views')
            .getByText(pick(locale, chinese, english), { exact: true })
            .click();
          if (name === 'market') {
            await page.locator('.jx-researchDataCatalog input.ant-input').first().fill('000300');
            await page.locator('.jx-researchDataCatalog-result').first().waitFor();
          }
        },
        marks: ['.jx-researchDataCatalog-views', '.jx-researchDataCatalog'],
      })),
      {
        name: 'research/embedded-reference',
        route: strategy,
        ready: '.jx-strategy-metrics',
        prepare: async () => {
          await button('引用数据', 'Reference data').click();
        },
        marks: ['.jx-embeddedToolbar-actions', '.jx-researchDataCatalog-views'],
      },
      {
        name: 'factors/factor-workspace-01',
        route: factor,
        ready: '[data-testid="factor-publication-card"]',
        prepare: async () => {
          await page
            .getByRole('tab', { name: pick(locale, '因子库', 'Library'), exact: true })
            .click();
        },
        marks: [
          '.jx-factor-agentTabs',
          '.jx-factor-libItem--active',
          '.jx-factor-presetBar',
          '.jx-factor-resultCol',
          '.jx-factor-dock',
        ],
      },
      {
        name: 'factors/report-question',
        route: factor,
        ready: '[data-testid="factor-publication-card"]',
        marks: [
          '.jx-factorQuestion-toolbar',
          '.jx-embeddedToolbar-actions',
          '[data-testid="factor-publication-card"]',
        ],
      },
      {
        name: 'factors/publication-current',
        route: factor,
        ready: '[data-testid="factor-publication-card"]',
        marks: [
          '[data-testid="factor-publication-card"]',
          '[data-testid="factor-use-in-strategy"]',
        ],
      },
      {
        name: 'signals/deployments-current',
        route: '/signals',
        ready: '.jx-signals-actions',
        prepare: async () => {
          await page
            .locator('.jx-signals-deploymentCard')
            .filter({ hasText: pick(locale, '运行中', 'Active') })
            .first()
            .click();
        },
        marks: ['.jx-signals-sidebar', '.jx-signals-actions'],
      },
      {
        name: 'market-valuation/valuation-overview-01',
        route: '/valuation',
        ready: '.jx-valuation-summary',
        marks: [
          '.jx-valuation-toolbar',
          '.jx-valuation-summary',
          '.jx-valuation-chartControls',
          '.jx-valuation-chartCard',
          '.jx-valuation-method',
        ],
      },
      {
        name: 'stock-detail/chart-overview-01',
        route: '/objects/stock/600519.SH',
        ready: '.jx-stock-chart canvas',
        marks: [
          '.jx-stock-title',
          '.jx-stock-toggle >> nth=0',
          '.jx-stock-toggle >> nth=1',
          '.jx-stock-chart',
        ],
      },
      {
        name: 'library/library-current',
        route: '/library',
        ready: '.jx-library-hero',
        marks: ['.jx-library-hero', '.jx-library-sections'],
      },
      {
        name: 'backtesting/strategy-description-01',
        route: '/strategy?new=1',
        ready: '.jx-strategy-heroInput',
        prepare: async () => {
          await page.getByText('TypeScript', { exact: true }).click();
          await selector('.jx-strategy-heroInput').fill(
            pick(
              locale,
              '只交易沪深300ETF（510300.SH）：每月第一个交易日买入100股；如果已经持有就不重复买入。',
              'Trade CSI 300 ETF (510300.SH): buy 100 shares on the first trading day of each month, only when no position is held.',
            ),
          );
        },
        marks: [
          '.jx-strategy-heroTitle',
          '.jx-strategy-heroInput',
          '.jx-strategy-examples',
          '.jx-strategy-heroLinks',
        ],
      },
      {
        name: 'research/run-controls-current',
        route: research,
        ready: '[data-testid="research-cell-python"]',
        marks: [
          '[data-testid="research-run-affected"]',
          '[data-testid="research-run-all"]',
          '[data-testid="research-open-execution-history"]',
        ],
      },
      {
        name: 'factors/create-current',
        route: factor,
        ready: '[data-testid="factor-publication-card"]',
        prepare: async () => {
          await button('新建', 'New').click();
        },
        marks: ['.ant-dropdown-menu'],
      },
      {
        name: 'factors/strategy-prefill-current',
        route: '/strategy?new=1&factorKey=ep',
        ready: '.jx-strategy-heroInput',
        marks: ['.jx-strategy-heroInput', '.jx-strategy-heroSend'],
      },
      {
        name: 'factor-weather/pin-current',
        route: '/factor-weather',
        ready: '.jx-factorWeather-header',
        prepare: async () => {
          await button('钉住因子', 'Pin factor').click();
        },
        marks: ['.ant-modal'],
      },
      {
        name: 'market-valuation/market-weather-overview-01',
        route: '/market',
        ready: '.jx-industryWeather-groups',
        marks: [
          '.jx-industryWeather-dimension',
          '.jx-industryWeather-frequency',
          '.jx-industryWeather-brief',
          '.jx-industryWeather-groups',
        ],
      },
      {
        name: 'market-valuation/valuation-index-01',
        route: '/valuation',
        ready: '.jx-valuation-summary',
        prepare: async () => {
          await selector('.jx-valuation-indexSelect').click();
        },
        marks: ['.jx-valuation-indexSelect', '.ant-select-dropdown'],
      },
      {
        name: 'signals/paused-current',
        route: '/signals',
        ready: '.jx-signals-actions',
        prepare: async () => {
          await page.locator(`[data-deployment-id="${config.pausedDeployment}"]`).click();
        },
        marks: ['.jx-signals-sidebar', '.jx-signals-signalHeader', '.jx-signals-actions'],
      },
    ];
    const filter = process.env.HELP_CAPTURE_SCENES?.split(',');
    if (filter?.some((name) => !scenes.some((scene) => scene.name === name))) {
      throw new Error('Unknown HELP_CAPTURE_SCENES entry');
    }
    for (const scene of scenes.filter((entry) => !filter || filter.includes(entry.name))) {
      await page.close();
      page = await context.newPage();
      if (scene.route.includes('new=1')) {
        // Capture the documented first-visit prompt, without inherited browser recents.
        await page.addInitScript(() => {
          localStorage.removeItem('jx-strategy-recents');
          localStorage.removeItem('jx-lab-recents');
        });
      }
      await page.goto(`${base}${scene.route}`, { waitUntil: 'networkidle' });
      await selector(scene.ready).waitFor();
      await scene.prepare?.();
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      // Allow chart animation and drawer transitions to finish before recording the artifact.
      await page.waitForTimeout(800);
      await capture(page, locale, scene);
      console.log(`[help-images] captured ${locale}/${scene.name}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

async function capture(page, locale, scene) {
  const relative = `${locale}/${scene.name}.png`;
  for (const directory of [raw, output]) {
    mkdirSync(dirname(resolve(directory, relative)), { recursive: true });
  }
  const options = {
    mask: [page.locator('.jx-topnav-email')],
    maskColor: '#ffffff',
    animations: 'disabled',
  };
  await page.screenshot({ ...options, path: resolve(raw, relative) });
  const marks = [];
  for (const [index, selector] of scene.marks.entries()) {
    const target = page.locator(selector).first();
    await target.waitFor({ state: 'visible' });
    const rectangle = await target.boundingBox();
    if (!rectangle || rectangle.y >= 1000 || rectangle.x >= 1600) {
      throw new Error(`Annotation outside viewport: ${scene.name} ${selector}`);
    }
    marks.push({ ...rectangle, number: index + 1 });
  }
  await page.evaluate((rectangles) => {
    for (const rectangle of rectangles) {
      const box = document.createElement('div');
      box.dataset.helpAnnotation = 'true';
      Object.assign(box.style, {
        position: 'fixed',
        left: `${Math.max(2, rectangle.x)}px`,
        top: `${Math.max(2, rectangle.y)}px`,
        width: `${Math.min(rectangle.width, innerWidth - rectangle.x - 4)}px`,
        height: `${Math.min(rectangle.height, innerHeight - rectangle.y - 4)}px`,
        border: '3px solid #e8463b',
        borderRadius: '6px',
        pointerEvents: 'none',
        zIndex: '99999',
      });
      const badge = document.createElement('span');
      badge.textContent = String(rectangle.number);
      Object.assign(badge.style, {
        position: 'absolute',
        top: rectangle.y < 15 ? '0' : '-14px',
        left: rectangle.x < 15 ? '0' : '-14px',
        width: '25px',
        height: '25px',
        borderRadius: '50%',
        background: '#e8463b',
        color: 'white',
        font: 'bold 17px/25px Arial',
        textAlign: 'center',
      });
      box.append(badge);
      document.body.append(box);
    }
  }, marks);
  try {
    await page.screenshot({ ...options, path: resolve(output, relative) });
  } finally {
    await page
      .locator('[data-help-annotation]')
      .evaluateAll((elements) => elements.forEach((element) => element.remove()));
  }
}
