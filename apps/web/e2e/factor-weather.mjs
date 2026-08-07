import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

await context.route('**/api/auth/me', (route) =>
  json(route, { user: { id: 'factor-weather-user', email: 'weather@test.com', name: null } }),
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
      strategyKey: 'mom',
      status: 'published',
      kind: 'price',
      builtin: true,
      expectedDirection: 'positive',
    },
    {
      key: 'custom-quality-id',
      label: '盈利质量变体',
      strategyKey: 'quality_v1',
      status: 'published',
      kind: 'custom',
    },
    {
      key: 'ep',
      label: '盈利收益率(1/PE_TTM)',
      strategyKey: 'ep',
      status: 'published',
      kind: 'fundamental',
      builtin: true,
      expectedDirection: 'positive',
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

  const firstCard = cards.first();
  const initialMonth = await firstCard.locator('.jx-factorWeather-metric').first().innerText();
  await firstCard.locator('.jx-factorWeather-monthCell').nth(22).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector('.jx-factorWeather-card .jx-factorWeather-metric')?.innerText !==
      previous,
    initialMonth,
    { timeout: 2_000 },
  );
  const historicalMonth = await firstCard.locator('.jx-factorWeather-metric').first().innerText();
  if (historicalMonth === initialMonth) {
    throw new Error('expected clicking the timeline to select a historical month');
  }

  await page.screenshot({ path: `${SHOTS}factor-weather-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: '钉住因子' }).click();
  await page.getByRole('dialog', { name: '钉住一个因子版本' }).waitFor();
  await page.locator('.jx-factorWeather-pickerControl').first().click();
  const options = await page.locator('.ant-select-item-option').count();
  if (options !== 2) {
    throw new Error(`expected two unpinned factor picker options, got ${options}`);
  }
  if ((await page.locator('.ant-select-item-option-disabled').count()) !== 1) {
    throw new Error('expected the draft factor option to be disabled');
  }
  await page.screenshot({ path: `${SHOTS}factor-weather-picker.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/factor-weather`, { waitUntil: 'networkidle' });
  await cards.first().waitFor();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) {
    throw new Error(`expected no mobile horizontal overflow, got ${overflow}px`);
  }
  await page.screenshot({ path: `${SHOTS}factor-weather-mobile.png`, fullPage: true });

  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${pageErrors.join('; ')}`);
  }
  console.log(
    `[factor-weather-e2e] two groups, 48 monthly cells, historical selection, picker, and mobile layout passed (${options} open options)`,
  );
} finally {
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
