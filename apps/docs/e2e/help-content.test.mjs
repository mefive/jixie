import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkHelpContent } from './help-content.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MANIFEST = 'docs/design/user-guide-images.json';
const ARTICLE = 'apps/docs/src/content/help/en/factors/report-history.md';

function fixture(context) {
  const root = mkdtempSync(resolve(tmpdir(), 'jixie-help-check-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    'apps/docs/src/content/help',
    'apps/docs/src/complex/help/articles.ts',
    MANIFEST,
  ]) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    cpSync(resolve(ROOT, path), resolve(root, path), { recursive: true });
  }
  mkdirSync(resolve(root, 'apps/docs/public/images'), { recursive: true });
  // The fixture only reads the real images; content and manifest mutations stay in its private copy.
  symlinkSync(
    resolve(ROOT, 'apps/docs/public/images/help'),
    resolve(root, 'apps/docs/public/images/help'),
  );
  return root;
}

function edit(root, path, transform) {
  const filename = resolve(root, path);
  writeFileSync(filename, transform(readFileSync(filename, 'utf8')));
}

function editManifest(root, transform) {
  edit(root, MANIFEST, (text) => {
    const manifest = JSON.parse(text);
    transform(manifest.images);
    return JSON.stringify(manifest);
  });
}

test('accepts the bilingual corpus without rewriting the inventory', () => {
  const before = readFileSync(resolve(ROOT, MANIFEST), 'utf8');
  const { summary } = checkHelpContent();
  assert.equal(summary.articlesPerLocale, 100);
  assert.equal(summary.learningEvidence, 29);
  assert.equal(readFileSync(resolve(ROOT, MANIFEST), 'utf8'), before);
});

test('rejects a missing translation', (context) => {
  const root = fixture(context);
  rmSync(resolve(root, ARTICLE));
  assert.throws(() => checkHelpContent(root), /en files differ from registry/);
});

test('rejects an unregistered internal article link', (context) => {
  const root = fixture(context);
  edit(root, ARTICLE, (text) => `${text}\n[Missing article](/docs/help/research/missing)\n`);
  assert.throws(() => checkHelpContent(root), /unknown help link/);
});

test('rejects a Chinese current screenshot in an English article', (context) => {
  const root = fixture(context);
  edit(root, ARTICLE, (text) =>
    text.replace('/en/factors/report-question.png', '/zh/factors/report-question.png'),
  );
  assert.throws(() => checkHelpContent(root), /wrong image locale/);
});

test('rejects a historical figure without its disclosure', (context) => {
  const root = fixture(context);
  edit(root, ARTICLE, (text) => text.replace('Historical Chinese UI example:', ''));
  assert.throws(() => checkHelpContent(root), /missing historical caption/);
});

test('rejects a current figure removed from only one language', (context) => {
  const root = fixture(context);
  edit(root, ARTICLE, (text) => text.replace(/^!\[.*\]\(.*report-question.png\)\n/gm, ''));
  assert.throws(() => checkHelpContent(root), /bilingual figure order differs/);
});

test('rejects stale manifest article references', (context) => {
  const root = fixture(context);
  editManifest(root, (images) => {
    images[0].articles = [];
  });
  assert.throws(() => checkHelpContent(root), /stale article references/);
});

test('rejects changed image bytes against the recorded checksum', (context) => {
  const root = fixture(context);
  editManifest(root, (images) => {
    images[0].sha256 = '0'.repeat(64);
  });
  assert.throws(() => checkHelpContent(root), /image hash mismatch/);
});

test('rejects learning evidence that differs from its original checksum', (context) => {
  const root = fixture(context);
  editManifest(root, (images) => {
    images.find((entry) => entry.disposition === 'historical-evidence').originalSha256 = '0'.repeat(
      64,
    );
  });
  assert.throws(() => checkHelpContent(root), /learning evidence changed/);
});

test('rejects a retired image that is still present or referenced', (context) => {
  const root = fixture(context);
  editManifest(root, (images) => {
    images[0].disposition = 'retired';
  });
  assert.throws(() => checkHelpContent(root), /retired image still exists/);
});
