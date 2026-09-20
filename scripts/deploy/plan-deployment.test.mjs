import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyChangedPaths } from './plan-deployment.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(scriptDirectory, '../../deploy/component-impact.json'), 'utf8'),
);

test('selects a single application', () => {
  assert.deepEqual(classifyChangedPaths(['apps/docs/src/App.tsx'], manifest), {
    api: false,
    web: false,
    docs: true,
    sandboxd: false,
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
      sandboxd: false,
      fullDeploy: false,
      installDependencies: false,
      reasons: ['api', 'web'],
    },
  );
});

test('API command dispatch selects the API deployment path', () => {
  const result = classifyChangedPaths(['apps/api/scripts/command-entry.ts'], manifest);
  assert.equal(result.api, true);
  assert.equal(result.fullDeploy, false);
  assert.deepEqual(result.reasons, ['api']);
});

test('shared package and request-contract subpaths select every application', () => {
  for (const changedPath of [
    'packages/shared/src/index.ts',
    'packages/shared/src/api/strategy.ts',
  ]) {
    const result = classifyChangedPaths([changedPath], manifest);
    assert.equal(result.api, true);
    assert.equal(result.web, true);
    assert.equal(result.docs, true);
    assert.equal(result.sandboxd, true);
    assert.equal(result.fullDeploy, true);
  }
});

test('deployment infrastructure selects every application', () => {
  for (const changedPath of [
    '.dockerignore',
    'scripts/bootstrap.sh',
    'scripts/deploy/deployment-gate.mjs',
    'scripts/maintenance/import-market-data.sh',
    'scripts/sandbox/setup.ts',
    'scripts/e2e/run.mjs',
    'scripts/e2e/commands.mjs',
  ]) {
    const result = classifyChangedPaths([changedPath], manifest);
    assert.equal(result.fullDeploy, true);
    assert.deepEqual(
      [result.api, result.web, result.docs, result.sandboxd],
      [true, true, true, true],
    );
  }
});

test('Strategy Python sources select both API and the sandbox image', () => {
  for (const changedPath of [
    'apps/api/src/strategy/sdk/python.py',
    'apps/api/src/strategy/runtime/python/runner.py',
  ]) {
    assert.deepEqual(classifyChangedPaths([changedPath], manifest), {
      api: true,
      web: false,
      docs: false,
      sandboxd: true,
      fullDeploy: false,
      installDependencies: false,
      reasons: ['api', 'sandboxd'],
    });
  }
});

test('Strategy TypeScript SDK changes still select only API', () => {
  const result = classifyChangedPaths(['apps/api/src/strategy/sdk/typescript.ts'], manifest);
  assert.equal(result.api, true);
  assert.equal(result.sandboxd, false);
  assert.equal(result.fullDeploy, false);
});

test('documentation changes do not rebuild runtime applications', () => {
  assert.deepEqual(classifyChangedPaths(['docs/deployment.md', 'README.md'], manifest), {
    api: false,
    web: false,
    docs: false,
    sandboxd: false,
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

test('selects the Python sandbox daemon independently', () => {
  assert.deepEqual(classifyChangedPaths(['apps/sandboxd/src/index.ts'], manifest), {
    api: false,
    web: false,
    docs: false,
    sandboxd: true,
    fullDeploy: false,
    installDependencies: false,
    reasons: ['sandboxd'],
  });
});

test('unknown paths fail safe to a full deployment', () => {
  const result = classifyChangedPaths(['packages/new-runtime/src/index.ts'], manifest);
  assert.equal(result.fullDeploy, true);
  assert.match(result.reasons[0], /^unknown:/);
});
