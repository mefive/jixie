import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bootstrap = await readFile(new URL('../bootstrap.sh', import.meta.url), 'utf8');
const cleanup = bootstrap.slice(
  bootstrap.indexOf('cleanup_deployment_gate() {'),
  bootstrap.indexOf('trap cleanup_deployment_gate EXIT'),
);
const migrationStart = bootstrap.indexOf(
  'if [[ "$DEPLOY_API" == "1" ]]; then\n  log "prisma generate"',
);
const migration = bootstrap.slice(
  migrationStart,
  bootstrap.indexOf('if [[ "$DEPLOY_WEB" == "1" ]]; then', migrationStart),
);

function runMigrationStage(deployApi, failure) {
  assert.ok(migrationStart > 0);
  assert.ok(cleanup.startsWith('cleanup_deployment_gate() {'));
  return spawnSync(
    'bash',
    [
      '-c',
      `
set -euo pipefail
DEPLOY_API="$1"
FAILURE="$2"
API_WAS_ACTIVE=1
API_DATA_MIGRATION_INCOMPLETE=0
ACTIVE_LIVE_DIR=''
ACTIVE_PREVIOUS_DIR=''
STAGING_DIR=''
DEPLOYMENT_RUN_ID=''
JIXIE_SERVICE='fixture-api'
DB_FILE='fixture.db'
NODE_HEAP_OPTIONS=''
log() { :; }
warn() { printf '%s\\n' "$*" >&2; }
systemctl() { return 1; }
sudo() { printf 'sudo %s\\n' "$*"; }
pnpm() {
  printf 'pnpm %s\\n' "$*"
  if [[ "$FAILURE" == 'data' && "$*" == *'db:migrate:factor-job-kinds'* ]]; then
    return 17
  fi
  if [[ "$FAILURE" == 'schema' && "$*" == *'prisma migrate deploy'* ]]; then
    return 18
  fi
}
${cleanup}
trap cleanup_deployment_gate EXIT
${migration}
printf 'deployment continued\\n'
`,
      'bootstrap-fixture',
      deployApi,
      failure,
    ],
    { encoding: 'utf8' },
  );
}

test('runs data conversion after schema migration and continues on success', () => {
  const result = runMigrationStage('1', 'none');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'pnpm --filter api exec prisma generate',
    'pnpm --filter api build',
    'pnpm --filter api exec prisma migrate deploy',
    'pnpm --filter api run db:migrate:factor-job-kinds',
    'deployment continued',
  ]);
});

test('a failed data migration stops deployment and does not restart the API in cleanup', () => {
  const result = runMigrationStage('1', 'data');
  assert.equal(result.status, 17, result.stderr);
  assert.doesNotMatch(result.stdout, /deployment continued|sudo systemctl start/);
  assert.match(result.stderr, /数据迁移未完成/);
});

test('preserves the existing cleanup behavior for failures before data conversion', () => {
  const result = runMigrationStage('1', 'schema');
  assert.equal(result.status, 18, result.stderr);
  assert.doesNotMatch(result.stdout, /db:migrate:factor-job-kinds|deployment continued/);
  assert.match(result.stdout, /sudo systemctl start fixture-api/);
});

test('does not run API data migrations for an unrelated deployment', () => {
  const result = runMigrationStage('0', 'none');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'deployment continued\n');
});

test('the real package command loads API-local env from a workspace root and propagates failure', async () => {
  const apiPackage = JSON.parse(
    await readFile(new URL('../../apps/api/package.json', import.meta.url), 'utf8'),
  );
  const directory = await mkdtemp(join(tmpdir(), 'jixie-migration-entry-'));
  try {
    const apiDirectory = join(directory, 'apps/api');
    await mkdir(join(apiDirectory, 'dist/scripts/migrations'), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true }));
    await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    await writeFile(
      join(apiDirectory, 'package.json'),
      JSON.stringify({
        name: 'api',
        type: 'module',
        scripts: {
          'db:migrate:factor-job-kinds': apiPackage.scripts['db:migrate:factor-job-kinds'],
        },
      }),
    );
    // Only API has an env file. The stub verifies process launch without touching any database.
    await writeFile(join(apiDirectory, '.env'), 'JIXIE_MIGRATION_ENTRY_FIXTURE=loaded\n');
    await writeFile(
      join(apiDirectory, 'dist/scripts/migrations/split-factor-job-kinds.js'),
      `
import assert from 'node:assert/strict';
assert.equal(process.env.JIXIE_MIGRATION_ENTRY_FIXTURE, 'loaded');
assert.ok(process.cwd().endsWith('/apps/api'));
console.log('migration entry fixture loaded');
process.exitCode = Number(process.env.JIXIE_MIGRATION_ENTRY_FAILURE || 0);
`,
    );
    const environment = { ...process.env };
    delete environment.JIXIE_MIGRATION_ENTRY_FIXTURE;
    delete environment.JIXIE_MIGRATION_ENTRY_FAILURE;
    const run = (failure) =>
      spawnSync('pnpm', ['--filter', 'api', 'run', 'db:migrate:factor-job-kinds'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...environment, JIXIE_MIGRATION_ENTRY_FAILURE: String(failure) },
      });
    const success = run(0);
    assert.equal(success.error, undefined);
    assert.equal(success.status, 0, success.stderr || success.stdout);
    assert.match(success.stdout, /migration entry fixture loaded/);
    const failure = run(17);
    assert.equal(failure.error, undefined);
    assert.notEqual(failure.status, 0);
    assert.match(failure.stdout, /migration entry fixture loaded/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
