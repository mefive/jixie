import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bootstrap = await readFile(new URL('../bootstrap.sh', import.meta.url), 'utf8');
const migrationStart = bootstrap.indexOf(
  'if [[ "$DEPLOY_API" == "1" ]]; then\n  SCHEMA_DATA_READY=0\n  log "prisma generate"',
);
const migration = bootstrap.slice(
  migrationStart,
  bootstrap.indexOf('if [[ "$DEPLOY_WEB" == "1" ]]; then\n  build_static_app', migrationStart),
);

test('deployment enables ingestion without launching a full history download', async () => {
  assert.doesNotMatch(bootstrap, /systemctl (?:start|restart|reset-failed) jixie-ingestion/);
  assert.doesNotMatch(bootstrap, /upgrade-minimal-sync|upgrade-sync-proofs|deployment-gate\.mjs/);
  assert.match(bootstrap, /check_blocking_maintenance/);
  const activation = await readFile(new URL('./activate-ingestion.sh', import.meta.url), 'utf8');
  assert.match(activation, /dist\/src\/ingestion\/cli\/data\.js/);
  assert.match(activation, /enable --now jixie-ingestion\.timer/);
  assert.match(
    activation,
    /disable --now jixie-maintenance\.timer jixie-maintenance-weekly\.timer/,
  );
  assert.doesNotMatch(activation, /data\.js ingest|prisma/);
  const service = await readFile(
    new URL('../../deploy/jixie-ingestion.service', import.meta.url),
    'utf8',
  );
  assert.match(service, /data\.js ingest/);
  assert.match(service, /^TimeoutStartSec=infinity$/m);
  assert.match(service, /JIXIE_INGESTION_TRIGGER=timer/);
});

for (const failure of ['migration', 'reset', 'none']) {
  test(`keeps one-time rebuild retryable across ${failure}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jixie-ingestion-bootstrap-'));
    try {
      const result = spawnSync(
        'bash',
        [
          '-c',
          `
        set -Eeuo pipefail
        DEPLOY_API=1
        JIXIE_DIR=/fixture
        DB_FILE=/fixture/test.db
        NODE_HEAP_OPTIONS=''
        INGESTION_REBUILD_MARKER="$TEST_DIRECTORY/rebuild"
        SCHEMA_DATA_READY=1
        log() { :; }
        sqlite3() { echo 1; }
        pnpm() {
          if [[ "$*" == *'migrate deploy'* && "$TEST_FAILURE" == migration ]]; then return 23; fi
        }
        node() {
          if [[ "$*" == *'reset --apply'* ]]; then
            [[ -f "$INGESTION_REBUILD_MARKER" ]]
            echo reset
            if [[ "$TEST_FAILURE" == reset ]]; then return 24; fi
          fi
        }
        trap 'status=$?; if [[ "$SCHEMA_DATA_READY" == 0 ]]; then echo API_STOPPED; fi; exit "$status"' EXIT
        ${migration}
        echo READY
      `,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, TEST_DIRECTORY: directory, TEST_FAILURE: failure },
        },
      );
      if (failure === 'none') {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /reset\nREADY/);
      } else {
        assert.equal(result.status, failure === 'migration' ? 23 : 24, result.stderr);
        assert.match(result.stdout, /API_STOPPED/);
        assert.doesNotMatch(result.stdout, /READY/);
        assert.ok(await readFile(join(directory, 'rebuild'), 'utf8').then(() => true));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
