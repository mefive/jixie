import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

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
  if [[ "$FAILURE" == 'data' && "$*" == *'split-factor-job-kinds.js'* ]]; then
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
    'pnpm --filter api exec node --env-file=.env dist/scripts/migrations/split-factor-job-kinds.js',
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
  assert.doesNotMatch(result.stdout, /split-factor-job-kinds|deployment continued/);
  assert.match(result.stdout, /sudo systemctl start fixture-api/);
});

test('does not run API data migrations for an unrelated deployment', () => {
  const result = runMigrationStage('0', 'none');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'deployment continued\n');
});
