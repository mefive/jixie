import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { prisma } from '#infra/database/prisma.js';
import { databaseFilename } from '#infra/coordination/market-access.js';
import { getOpenDates } from '#market/calendar/read.js';
import { syncMarketIndicators } from '#market/state/sync.js';
import { validateDerivedMarketRange } from '#market/state/quality.js';
import { runDataQualityAudit } from '../publication/audit.js';
import { manifestSchema } from './manifest.js';
import { saveJson } from './snapshot.js';

const DERIVED_INPUTS = new Set([
  'Daily',
  'AdjFactor',
  'DailyBasic',
  'StkLimit',
  'IndexWeight',
  'IndexDaily',
  'SwIndustryMember',
  'SwIndexDaily',
  'StockBasic',
  'StockNameHistory',
  'StockCodeChange',
]);

/**
 * 依据原始变更清单保守确定影响起点；完成重算和审计才允许正式发布。
 *
 * Derive a conservative affected range from frozen raw changes; recompute and audit before publication.
 */
export async function finalizeCandidate(): Promise<void> {
  const directory = dirname(databaseFilename());
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  const bounds = await prisma.daily.aggregate({
    _min: { tradeDate: true },
    _max: { tradeDate: true },
  });
  const first = bounds._min.tradeDate;
  const last = bounds._max.tradeDate;
  if (!first || !last) {
    if (['daily', 'weekly', 'repair', 'import'].includes(manifest.command)) {
      throw new Error('Required candidate market history is empty');
    }
    return;
  }
  const state = await prisma.maintenanceState.findUnique({ where: { key: 'global' } });
  const end = state?.dailyPublishedThrough ?? last;
  if (manifest.command === 'sync' && !state?.dailyPublishedThrough) {
    return;
  }
  let earliest: string | undefined;
  for (const changes of manifest.changes) {
    if (!DERIVED_INPUTS.has(changes.table) || changes.count === 0) {
      continue;
    }
    const lines = createInterface({
      input: createReadStream(resolve(directory, `${changes.table}.changes`)),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of lines) {
        const change = JSON.parse(line) as { row: { tradeDate?: string } };
        const start = change.row.tradeDate ?? first;
        earliest = earliest && earliest < start ? earliest : start;
      }
    } finally {
      lines.close();
    }
  }
  if (earliest && earliest <= end) {
    await syncMarketIndicators(earliest, end);
    await validateDerivedMarketRange(earliest, end, await getOpenDates(earliest, end));
  }
  if (['weekly', 'repair', 'import', 'canonicalize'].includes(manifest.command)) {
    const audit = await runDataQualityAudit(prisma, { startDate: first, endDate: end });
    await saveJson(resolve(directory, 'audit.json'), audit);
    const errors = audit.findings.filter((finding) => finding.status === 'error');
    if (errors.length) {
      throw new Error(
        `Candidate audit found ${errors.length} errors: ${errors.map((entry) => entry.title).join(', ')}`,
      );
    }
  }
  // 仅作完整性检查，不从候选 SQL 推断业务模型。
  // Integrity checking does not derive business models from administrative SQL.
  const inspector = new DatabaseSync(databaseFilename(), { readOnly: true });
  try {
    if (inspector.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('Candidate has foreign-key violations');
    }
  } finally {
    inspector.close();
  }
}
