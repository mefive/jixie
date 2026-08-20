import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const suffix = Date.now().toString(36).slice(-7);
const creator = `e2e-library-author-${suffix}@test.com`;
const viewer = `e2e-library-reader-${suffix}@test.com`;
let sourceId = '';
let copiedId = '';

const api = async (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      const text = await response.text();
      return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null };
    },
    { path, init },
  );

const login = async (email) => {
  const result = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!result.ok) {
    throw new Error(`dev login failed for ${email}: ${result.status}`);
  }
};

try {
  await mkdir(SHOTS, { recursive: true });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await login(creator);

  const created = await api('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '月末等权示例',
      start: '20240101',
      end: '20241231',
      initialCash: 1_000_000,
      code: `export default defineStrategy({ name: '月末等权示例', watch: ['510300.SH'], onBar() {} });`,
    }),
  });
  if (!created.ok || !created.body?.id) {
    throw new Error(`strategy create failed: ${JSON.stringify(created)}`);
  }
  sourceId = created.body.id;

  const shared = await api(`/api/app/strategies/${sourceId}/visibility`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visibility: 'public' }),
  });
  if (!shared.ok || shared.body?.visibility !== 'public') {
    throw new Error(`strategy share failed: ${JSON.stringify(shared)}`);
  }

  await login(viewer);
  const library = await api('/api/app/library');
  const publicStrategy = library.body?.strategies?.find((asset) => asset.id === sourceId);
  if (!library.ok || !publicStrategy || publicStrategy.owned) {
    throw new Error(`public strategy is not visible to the reader: ${JSON.stringify(library)}`);
  }
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '公共策略与因子库' }).waitFor();
  const card = page.locator('.jx-library-card').filter({ hasText: publicStrategy.name });
  await card.getByText('复制到我的空间', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}public-library.png`, fullPage: true });

  await card.getByRole('button', { name: '复制到我的空间' }).click();
  await page.waitForURL(/\/lab\?id=/, { timeout: 30_000 });
  copiedId = new URL(page.url()).searchParams.get('id') ?? '';
  const copied = copiedId ? await api(`/api/app/strategies/${copiedId}`) : null;
  if (!copiedId || !copied?.ok || copied.body?.visibility !== 'private') {
    throw new Error(
      `copied strategy is not an independent private asset: ${JSON.stringify(copied)}`,
    );
  }

  console.log(
    `[public-library] PASS source=${sourceId} copy=${copiedId} screenshot=${SHOTS}public-library.png`,
  );
} finally {
  if (copiedId) {
    await api(`/api/app/strategies/${copiedId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (sourceId) {
    await login(creator).catch(() => {});
    await api(`/api/app/strategies/${sourceId}`, { method: 'DELETE' }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
