import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { databaseFilename } from '#infra/coordination/market-access.js';
import { getOpenDates } from '#market/calendar/read.js';
import { syncMarketIndicators } from '#market/state/sync.js';
import { validateDerivedMarketRange } from '#market/state/quality.js';
import { allMarketIndicatorScope } from '#market/state/scope.js';
import { runDataQualityAudit, type DataQualityAuditReport } from '../publication/audit.js';
import { manifestSchema } from './manifest.js';
import { planDerivedImpact } from './impact.js';
import { saveJson } from './snapshot.js';

/**
 * 冻结原始输入后统一计算、检查派生、审计；日水位不裁掉 repair 的新增输出。
 *
 * Compute, validate derived outputs, then audit frozen inputs without clipping repairs to the watermark.
 */
export async function finalizeCandidate(): Promise<void> {
  const directory = dirname(databaseFilename());
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  if (manifest.command === 'sync') {
    const state = await prisma.maintenanceState.findUnique({ where: { key: 'global' } });
    // 未建立发布基线的分项导入仍由后续初始化完成整体验证。
    // Standalone imports before baseline publication are validated by subsequent initialization.
    if (!state?.dailyPublishedThrough) {
      return;
    }
  }

  const [bounds, derivedBounds, run] = await Promise.all([
    prisma.daily.aggregate({ _min: { tradeDate: true }, _max: { tradeDate: true } }),
    prisma.marketIndicator.aggregate({ _min: { tradeDate: true }, _max: { tradeDate: true } }),
    prisma.maintenanceRun.findFirst({
      where: { kind: manifest.command },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const first = [bounds._min.tradeDate, derivedBounds._min.tradeDate]
    .filter((date): date is string => !!date)
    .sort()[0];
  const last = [bounds._max.tradeDate, derivedBounds._max.tradeDate]
    .filter((date): date is string => !!date)
    .sort()
    .at(-1);
  if (!first || !last) {
    if (['daily', 'weekly', 'repair', 'import'].includes(manifest.command)) {
      throw new Error('Required candidate market history is empty');
    }
    return;
  }
  const summary = z.record(z.string(), z.json()).parse(run?.summary ?? {});
  const dateValue = (value: unknown) =>
    typeof value === 'string' && /^\d{8}$/.test(value) ? value : undefined;
  let targetStart: string | undefined;
  let targetEnd: string | undefined;
  switch (manifest.command) {
    case 'repair':
      targetStart = run?.startDate ?? dateValue(manifest.args[0]);
      targetEnd = run?.endDate ?? dateValue(manifest.args[1]);
      break;
    case 'daily': {
      targetStart = dateValue(summary.startDate);
      targetEnd = dateValue(summary.readyThrough);
      // 首次初始化后可能另建 signals-only 日记录，不能因此丢失基线输出要求。
      // A later signal-only run must not hide the baseline initialized in this candidate.
      const baseline = await prisma.maintenanceRun.findFirst({
        where: { kind: 'daily', targetKey: { startsWith: 'baseline:' }, status: 'done' },
        orderBy: { startedAt: 'desc' },
        select: { startDate: true, endDate: true },
      });
      if (baseline?.startDate && (!targetStart || baseline.startDate < targetStart)) {
        targetStart = baseline.startDate;
      }
      targetEnd ??= baseline?.endDate ?? undefined;
      break;
    }
    case 'import':
      [targetStart, targetEnd] = manifest.args;
      break;
    case 'weekly':
      targetStart = dateValue(summary.auditStart);
      targetEnd = dateValue(summary.auditEnd);
      break;
    case 'sync':
      if (manifest.args[0] === 'market-state') {
        [targetStart, targetEnd] = manifest.args.slice(1);
      }
      break;
    case 'canonicalize':
      break;
  }
  if (['repair', 'import'].includes(manifest.command) && (!targetStart || !targetEnd)) {
    throw new Error('Candidate has no explicit output range');
  }
  const requiredDates =
    targetStart && targetEnd && ['daily', 'repair', 'import'].includes(manifest.command)
      ? await getOpenDates(targetStart, targetEnd)
      : [];
  const outputEnd = targetEnd && targetEnd > last ? targetEnd : last;
  const dates = await getOpenDates(first, outputEnd);
  const ranges = await planDerivedImpact(directory, manifest.changes, dates, requiredDates);

  // 只有这一次计算改变输出；之后的派生检查和综合审计均只读同一批最终输入。
  // All writes finish here; subsequent derived checks and audits read the same final inputs.
  for (const range of ranges) {
    await syncMarketIndicators(range.startDate, range.endDate, range.scope);
  }
  for (const range of ranges) {
    await validateDerivedMarketRange(
      range.startDate,
      range.endDate,
      await getOpenDates(range.startDate, range.endDate),
      range.scope,
    );
  }
  if (manifest.command === 'sync' && targetStart && targetEnd) {
    await validateDerivedMarketRange(
      targetStart,
      targetEnd,
      await getOpenDates(targetStart, targetEnd),
      allMarketIndicatorScope(),
    );
  }

  if (['daily', 'weekly', 'repair', 'import', 'canonicalize'].includes(manifest.command)) {
    const audits: DataQualityAuditReport[] = [];
    const auditStart = targetStart ?? ranges[0]?.startDate ?? last;
    const auditEnd = targetEnd ?? ranges.at(-1)?.endDate ?? last;
    const audit = await runDataQualityAudit(prisma, {
      startDate: auditStart,
      endDate: auditEnd,
      windowTradingDays: 60,
      evaluationPoints: 3,
    });
    audits.push(audit);
    // 历史价格修订需审计对应原始截面；仅成员变化由对应派生检查及全局资料审计覆盖。
    // Audit historical raw-panel changes; membership-only changes retain scoped derived and reference checks.
    for (const range of ranges) {
      if (!range.scope.market) {
        continue;
      }
      if (range.startDate < auditStart) {
        const historyDates = dates.filter(
          (date) => date >= range.startDate && date <= range.endDate && date < auditStart,
        );
        if (historyDates.length) {
          audits.push(
            await runDataQualityAudit(prisma, {
              startDate: historyDates[0],
              endDate: historyDates.at(-1)!,
            }),
          );
        }
      }
      if (range.endDate > auditEnd) {
        const historyDates = dates.filter(
          (date) => date >= range.startDate && date <= range.endDate && date > auditEnd,
        );
        if (historyDates.length) {
          audits.push(
            await runDataQualityAudit(prisma, {
              startDate: historyDates[0],
              endDate: historyDates.at(-1)!,
            }),
          );
        }
      }
    }
    await saveJson(resolve(directory, 'audit.json'), {
      ...audit,
      affectedAudits: audits.slice(1),
      derivedRanges: ranges,
    });
    if (run) {
      await prisma.maintenanceRun.update({
        where: { id: run.id },
        data: {
          summary: {
            ...summary,
            ...(manifest.command === 'weekly'
              ? {
                  auditErrors: audits
                    .flatMap((report) => report.findings)
                    .filter((finding) => finding.status === 'error').length,
                  auditWarnings: audits
                    .flatMap((report) => report.findings)
                    .filter((finding) => finding.status === 'warn').length,
                  auditFindings: JSON.parse(
                    JSON.stringify(
                      audits
                        .flatMap((report) => report.findings)
                        .filter((finding) => finding.status !== 'pass'),
                    ),
                  ),
                }
              : {}),
            audit: JSON.parse(JSON.stringify(audit)),
            affectedAudits: JSON.parse(JSON.stringify(audits.slice(1))),
          },
        },
      });
    }
    const errors = audits.flatMap((report) =>
      report.findings.filter((finding) => finding.status === 'error'),
    );
    if (errors.length) {
      throw new Error(
        `Candidate audit found ${errors.length} errors: ${errors.map((entry) => entry.title).join(', ')}`,
      );
    }
  }

  const inspector = new DatabaseSync(databaseFilename(), { readOnly: true });
  try {
    if (inspector.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('Candidate has foreign-key violations');
    }
  } finally {
    inspector.close();
  }
}
