#!/usr/bin/env node
// Coordinate bootstrap downtime through stable SQLite tables without loading a migration-sensitive Prisma Client.
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [command, databaseFile, ...args] = process.argv.slice(2);
if (!command || !databaseFile) {
  fail('Usage: deployment-gate.mjs begin|finish DATABASE_FILE [ARG...]');
}

const database = new DatabaseSync(databaseFile);
database.exec('PRAGMA busy_timeout = 5000');

try {
  switch (command) {
    case 'begin':
      await begin(args);
      break;
    case 'finish':
      finish(args);
      break;
    default:
      fail(`Unknown deployment gate command: ${command}`);
  }
} finally {
  database.close();
}

async function begin(commandArgs) {
  const [targetKey, ...rest] = commandArgs;
  if (!targetKey || rest.length > 0) {
    fail('Usage: deployment-gate.mjs begin DATABASE_FILE TARGET_KEY');
  }

  const runId = `deploy-${Date.now().toString(36)}-${randomUUID()}`;
  const deploymentTargetKey = `${targetKey}:${runId}`;
  const now = Date.now();
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        `UPDATE "MaintenanceRun"
         SET status = 'error',
             stage = 'interrupted',
             error = 'Previous maintenance process exited before recording a terminal state',
             heartbeatAt = ?,
             finishedAt = ?,
             updatedAt = ?
         WHERE status = 'running'`,
      )
      .run(now, now, now);
    database
      .prepare(
        `INSERT INTO "MaintenanceRun" (
           id, kind, targetKey, trigger, status, stage, heartbeatAt, startedAt, createdAt, updatedAt
         ) VALUES (?, 'deploy', ?, 'manual', 'running', 'waiting_for_jobs', ?, ?, ?, ?)`,
      )
      .run(runId, deploymentTargetKey, now, now, now, now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  let gateActive = true;
  const closeGate = () => {
    if (!gateActive) {
      return;
    }
    markFinished(runId, 'error', 'Bootstrap stopped while waiting for background work');
    gateActive = false;
  };
  process.once('SIGINT', () => {
    closeGate();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    closeGate();
    process.exit(143);
  });

  try {
    await waitForRunningWork(runId);
    updateStage(runId, 'ready_to_stop');
    gateActive = false;
    process.stdout.write(`${runId}\n`);
  } catch (error) {
    closeGate();
    throw error;
  }
}

function finish(commandArgs) {
  const [runId, outcome, ...rest] = commandArgs;
  if (!runId || (outcome !== 'done' && outcome !== 'error') || rest.length > 0) {
    fail('Usage: deployment-gate.mjs finish DATABASE_FILE RUN_ID done|error');
  }

  markFinished(
    runId,
    outcome,
    outcome === 'error' ? 'Bootstrap exited before deployment completed' : null,
  );
}

async function waitForRunningWork(runId) {
  const timeoutMilliseconds = positiveInteger(
    process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS,
    120_000,
  );
  const quietMilliseconds = positiveInteger(process.env.MAINTENANCE_JOB_QUIET_MS, 5_000);
  const deadline = Date.now() + timeoutMilliseconds;
  let quietSince = null;

  for (;;) {
    const counts = database
      .prepare(
        `SELECT
           (SELECT count(*) FROM "Job" WHERE status IN ('queued', 'running')) AS jobs,
           (SELECT count(*) FROM "AgentTurn" WHERE status = 'running') AS agentTurns`,
      )
      .get();
    const jobs = Number(counts.jobs);
    const agentTurns = Number(counts.agentTurns);
    const now = Date.now();
    heartbeat(runId);

    if (jobs + agentTurns === 0) {
      quietSince ??= now;
      if (now - quietSince >= quietMilliseconds) {
        return;
      }
    } else {
      quietSince = null;
      process.stderr.write(
        `[deployment] Waiting for ${jobs} background jobs and ${agentTurns} Agent turns\n`,
      );
    }
    if (now >= deadline) {
      throw new Error(
        `Timed out waiting for ${jobs} background jobs and ${agentTurns} Agent turns`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

function heartbeat(runId) {
  const now = Date.now();
  database
    .prepare(
      `UPDATE "MaintenanceRun"
       SET heartbeatAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(now, now, runId);
}

function updateStage(runId, stage) {
  const now = Date.now();
  database
    .prepare(
      `UPDATE "MaintenanceRun"
       SET stage = ?, heartbeatAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(stage, now, now, runId);
}

function markFinished(runId, status, error) {
  const now = Date.now();
  const stage = status === 'done' ? 'complete' : 'error';
  database
    .prepare(
      `UPDATE "MaintenanceRun"
       SET status = ?, stage = ?, error = ?, heartbeatAt = ?, finishedAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(status, stage, error, now, now, now, runId);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message) {
  throw new Error(message);
}
