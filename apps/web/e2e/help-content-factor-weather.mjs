import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/factor-weather/', import.meta.url)
  .pathname;
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const pageErrors = [];
const log = (...args) => console.log('[help-factor-weather-e2e]', ...args);
page.on('pageerror', (error) => pageErrors.push(error.message));

await context.route('**/api/auth/me', (route) =>
  json(route, { user: { id: 'factor-weather-docs', email: 'weather-docs@test.com', name: null } }),
);
await context.route('**/api/maintenance/status', (route) =>
  json(route, {
    active: false,
    runId: null,
    kind: null,
    startDate: null,
    endDate: null,
    completedDates: 0,
    totalDates: 0,
    lastSuccessfulDailyDate: '20260731',
    stage: null,
    startedAt: null,
    heartbeatAt: null,
    error: null,
    retryAfterSeconds: 0,
  }),
);
await context.route('**/api/app/factors/catalog', (route) =>
  json(route, [
    {
      key: 'mom',
      label: '动量(60日,跳5)',
      strategyKey: 'custom:mom',
      kind: 'price',
      builtin: true,
      expectedDirection: 'positive',
    },
    {
      key: 'custom-quality-id',
      label: '盈利质量变体',
      strategyKey: 'custom:quality_v1',
      kind: 'custom',
    },
    {
      key: 'ep',
      label: '盈利收益率(1/PE_TTM)',
      strategyKey: 'custom:ep',
      kind: 'fundamental',
      builtin: true,
      expectedDirection: 'positive',
    },
    {
      key: 'custom-value-id',
      label: '价值质量组合变体',
      strategyKey: 'custom:value_quality_v1',
      kind: 'custom',
    },
    { key: 'draft-id', label: '尚未定稿', kind: 'custom' },
  ]),
);
await context.route('**/api/app/factor-weather', (route) =>
  json(route, {
    methodology: {
      frequency: 'month',
      neutral: 'size_industry',
      weighting: 'equal',
      groups: 10,
      partialMonth: false,
    },
    pins: [
      weatherPin('pin-mom', 'mom', '动量(60日,跳5)', true, 'positive', 0.012),
      weatherPin('pin-quality', 'custom-quality-id', '盈利质量变体', false, 'negative', -0.008),
    ],
  }),
);

try {
  await page.goto(`${BASE}/factor-weather`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '因子气象', exact: true }).waitFor();
  const cards = page.locator('.jx-factorWeather-card');
  if ((await cards.count()) !== 2) {
    throw new Error(`expected two factor cards, got ${await cards.count()}`);
  }
  if ((await page.locator('.jx-factorWeather-monthCell').count()) !== 48) {
    throw new Error('expected 24 monthly cells on each factor card');
  }

  await annotatedScreenshot(`${OUTPUT}factor-weather-overview-01.png`, [
    { locator: page.locator('.jx-factorWeather-methodology'), number: 1 },
    { locator: page.locator('.jx-factorWeather-groups'), number: 2 },
    { locator: cards.first(), number: 3 },
    { locator: page.getByRole('button', { name: '钉住因子' }), number: 4 },
  ]);

  await page.getByRole('button', { name: '钉住因子' }).click();
  const dialog = page.getByRole('dialog', { name: '钉住一个因子版本' });
  await dialog.waitFor();
  await dialog.locator('.jx-factorWeather-pickerControl').first().click();
  await page.getByText('价值质量组合变体', { exact: true }).click();
  const openDropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  if ((await openDropdown.count()) > 0) {
    await page.keyboard.press('Escape');
  }
  await openDropdown.waitFor({ state: 'hidden' });
  const confirmPin = page.locator('.ant-modal-footer .ant-btn-primary');
  await confirmPin.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.ant-modal-footer .ant-btn-primary')?.hasAttribute('disabled'),
  );
  await annotatedScreenshot(`${OUTPUT}factor-weather-pin-01.png`, [
    { locator: dialog.locator('.jx-factorWeather-pickerControl').nth(0), number: 1 },
    { locator: dialog.locator('.jx-factorWeather-pickerControl').nth(1), number: 2 },
    { locator: confirmPin, number: 3 },
  ]);
  await page.locator('.ant-modal-footer .ant-btn-default').click();
  await dialog.waitFor({ state: 'hidden' });

  const firstCard = cards.first();
  await firstCard.locator('.jx-factorWeather-monthCell').nth(22).click();
  await firstCard.locator('.jx-factorWeather-monthCell--selected').nth(0).waitFor();
  await annotatedScreenshot(`${OUTPUT}factor-weather-history-01.png`, [
    { locator: firstCard.locator('.jx-factorWeather-monthCell--selected'), number: 1 },
    { locator: firstCard.locator('.jx-factorWeather-summary'), number: 2 },
    { locator: firstCard.locator('.jx-factorWeather-monthStrip'), number: 3 },
    { locator: firstCard.locator('.jx-factorWeather-detail'), number: 4 },
  ]);

  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${pageErrors.join('; ')}`);
  }
  log('factor weather screenshots completed');
} finally {
  await context.close();
  await browser.close();
}

function weatherPin(id, factorId, factorName, builtin, direction, baseReturn) {
  return {
    id,
    factorId,
    factorName,
    builtin,
    direction,
    status: 'ready',
    computedThrough: '20260731',
    codeHash: `${id}-hash`,
    createdAt: '2024-01-01T00:00:00.000Z',
    points: Array.from({ length: 24 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 7 + index + 1, 0));
      const dateText = date.toISOString().slice(0, 10).replaceAll('-', '');
      const wave = Math.sin(index * 0.85) * 0.018;
      return {
        formationDate: previousMonthEnd(date),
        periodEndDate: dateText,
        rankIc: baseReturn + wave * 0.8,
        topReturn: 0.02 + wave,
        bottomReturn: 0.008 - wave / 2,
        longShortGrossReturn: baseReturn + wave,
        longShortNetReturn: baseReturn + wave - 0.0025,
        topTurnover: 0.18 + (index % 5) * 0.025,
        sampleSize: 3200 + index * 7,
        sampleCoverage: 0.86 + (index % 4) * 0.015,
      };
    }),
  };
}

function previousMonthEnd(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0))
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');
}

async function json(route, body) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function annotatedScreenshot(path, marks) {
  const annotations = [];
  for (const mark of marks) {
    const box = await mark.locator.first().boundingBox();
    if (!box) {
      throw new Error(`annotation ${mark.number} target is not visible for ${path}`);
    }
    annotations.push({ ...box, number: mark.number });
  }

  await page.evaluate((items) => {
    const layer = document.createElement('div');
    layer.dataset.helpAnnotations = 'true';
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    for (const item of items) {
      const outline = document.createElement('div');
      outline.style.cssText = [
        'position:absolute',
        `left:${Math.max(2, item.x - 4)}px`,
        `top:${Math.max(2, item.y - 4)}px`,
        `width:${Math.max(8, item.width + 8)}px`,
        `height:${Math.max(8, item.height + 8)}px`,
        'border:3px solid #e8463b',
        'border-radius:9px',
        'box-sizing:border-box',
        'box-shadow:0 0 0 2px rgba(255,255,255,.9)',
      ].join(';');
      const badge = document.createElement('div');
      badge.textContent = String(item.number);
      badge.style.cssText = [
        'position:absolute',
        `left:${Math.max(4, item.x - 15)}px`,
        `top:${Math.max(4, item.y - 15)}px`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:28px',
        'height:28px',
        'border:2px solid #fff',
        'border-radius:999px',
        'background:#e8463b',
        'color:#fff',
        'font-size:15px',
        'font-weight:700',
        'line-height:1',
        'box-shadow:0 2px 7px rgba(0,0,0,.3)',
      ].join(';');
      layer.append(outline, badge);
    }
    document.body.append(layer);
  }, annotations);
  await page.screenshot({ path });
  await page.evaluate(() => {
    document.querySelector('[data-help-annotations="true"]')?.remove();
  });
  log('wrote', path.split('/').at(-1));
}
