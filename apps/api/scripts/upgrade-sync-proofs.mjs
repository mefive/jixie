import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/**
 * 停服升级时撤销受影响的旧凭证；旧列删除后自然停止，不引入新的规则版本或标记表。
 *
 * Revoke affected proofs during offline upgrade; removing the legacy column ends this transition.
 * No replacement rule versions or marker tables are created.
 */
export function upgradeSyncProofs(filename, apply = false) {
  if (!existsSync(filename)) {
    return 0;
  }

  // 旧 schema 无法用当前 Prisma Client 读取；此工具只用于离线升级。
  // The current Prisma Client cannot read this legacy schema; this tool is offline-only.
  const database = new DatabaseSync(filename, { readOnly: !apply });
  let transactionOpen = false;
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    if (
      !database
        .prepare('PRAGMA table_info(DatasetSyncPartition)')
        .all()
        .some((column) => column.name === 'policyVersion')
    ) {
      return 0;
    }
    if (apply) {
      database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
    }

    // 更早的协议凭证无法保留依赖资格；已部署的新协议只重查本次来源选择涉及的数据。
    // Older protocol proofs require dependency revalidation; recent proofs only need source repair.
    // 这些字符串仅识别历史存储，运行中的同步不再携带或比较版本。
    // These strings identify legacy storage only; normal synchronization has no version checks.
    const olderProtocol = database
      .prepare(
        `
      SELECT 1 FROM DatasetSyncPartition
      WHERE status IN ('complete', 'not_applicable', 'unavailable')
        AND policyVersion NOT IN ('sync-v2', 'indicator-source-v3', 'stock-source-v3')
      LIMIT 1
    `,
      )
      .get();
    const affected = olderProtocol
      ? '1 = 1'
      : `dataset IN (
      'stock-names', 'stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits',
      'index-weights', 'financial-statements', 'financial-indicators', 'dividends'
    )`;
    const proofs = `status IN ('complete', 'not_applicable', 'unavailable') AND ${affected}`;
    const states = `verifiedThrough IS NOT NULL AND ${affected}`;
    const proofCount = database
      .prepare(`SELECT COUNT(*) AS count FROM DatasetSyncPartition WHERE ${proofs}`)
      .get().count;
    const stateCount = database
      .prepare(`SELECT COUNT(*) AS count FROM DatasetSyncState WHERE ${states}`)
      .get().count;
    const count = Number(proofCount) + Number(stateCount);

    if (apply) {
      database
        .prepare(`UPDATE DatasetSyncPartition SET status = 'superseded' WHERE ${proofs}`)
        .run();
      database.prepare(`UPDATE DatasetSyncState SET verifiedThrough = NULL WHERE ${states}`).run();
      if (count > 0) {
        database.exec(`
          INSERT INTO MarketDataState (key, revision, updatedAt)
          VALUES ('global', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
          ON CONFLICT(key) DO UPDATE SET revision = revision + 1, updatedAt = excluded.updatedAt
        `);
      }
      database.exec('COMMIT');
      transactionOpen = false;
    }

    return count;
  } catch (error) {
    if (transactionOpen) {
      database.exec('ROLLBACK');
    }
    throw error;
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, filename, extra] = process.argv.slice(2);
  if (!filename || extra || !['check', 'apply'].includes(command)) {
    console.error('Usage: upgrade-sync-proofs.mjs check|apply DATABASE_FILE');
    process.exitCode = 2;
  } else {
    try {
      console.log(upgradeSyncProofs(resolve(filename), command === 'apply'));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
