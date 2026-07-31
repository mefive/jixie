import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyChangedPaths } from './plan-deployment.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(scriptDirectory, '../deploy/component-impact.json'), 'utf8'),
);

test('selects a single application', () => {
  assert.deepEqual(classifyChangedPaths(['apps/docs/src/App.tsx'], manifest), {
    api: false,
    web: false,
    docs: true,
    fullDeploy: false,
    installDependencies: false,
    reasons: ['docs'],
  });
});

test('unions independently changed applications', () => {
  assert.deepEqual(
    classifyChangedPaths(['apps/api/src/index.ts', 'apps/web/src/main.tsx'], manifest),
    {
      api: true,
      web: true,
      docs: false,
      fullDeploy: false,
      installDependencies: false,
      reasons: ['api', 'web'],
    },
  );
});

test('shared package selects every application', () => {
  const result = classifyChangedPaths(['packages/shared/src/index.ts'], manifest);
  assert.equal(result.api, true);
  assert.equal(result.web, true);
  assert.equal(result.docs, true);
  assert.equal(result.fullDeploy, true);
});

test('deployment infrastructure selects every application', () => {
  const result = classifyChangedPaths(['scripts/bootstrap.sh'], manifest);
  assert.equal(result.fullDeploy, true);
  assert.deepEqual([result.api, result.web, result.docs], [true, true, true]);
});

test('documentation changes do not rebuild runtime applications', () => {
  assert.deepEqual(classifyChangedPaths(['docs/deployment.md', 'README.md'], manifest), {
    api: false,
    web: false,
    docs: false,
    fullDeploy: false,
    installDependencies: false,
    reasons: [],
  });
});

test('application package changes install dependencies', () => {
  const result = classifyChangedPaths(['apps/docs/package.json'], manifest);
  assert.equal(result.docs, true);
  assert.equal(result.installDependencies, true);
});

test('unknown paths fail safe to a full deployment', () => {
  const result = classifyChangedPaths(['packages/new-runtime/src/index.ts'], manifest);
  assert.equal(result.fullDeploy, true);
  assert.match(result.reasons[0], /^unknown:/);
});
