import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isObservationDate } from '#market/synchronization/date.js';

/**
 * 数据命令速查；参数在这里和 --help 中说明。
 *
 * Data command reference; parameters are documented here and in --help.
 *
 * pnpm data ingest [--to YYYYMMDD]
 * --to：可选截止日；省略时使用启动当天的上海日期。
 * --to: optional target; defaults to the Shanghai calendar date at startup.
 *
 * pnpm data runs [--limit N]
 * --limit：最近运行条数，默认 5，允许 1 至 100；仅返回 id、status、startedAt、finishedAt。
 * --limit: recent run count, default 5, range 1–100; returns only id/status/startedAt/finishedAt.
 * 示例 / Example: pnpm data runs --limit 1
 * pnpm data issues RUN_ID
 * RUN_ID：runs 返回的运行 ID；issues 原命令输出该轮全部历史诊断。
 * RUN_ID: a run ID from runs; the original issues command lists all historical diagnostics.
 *
 * pnpm data issues reconcile [RUN_ID]
 * 幂等补齐已结束运行的处理记录；省略 RUN_ID 时检查所有已结束且有问题的运行，不重置已有结果。
 * Idempotently reconcile finished-run handling; omit RUN_ID for all finished runs with issues, preserving existing results.
 *
 * pnpm data issues export RUN_ID --out FILE [--issue ISSUE_ID]
 * --out：必填，JSON 输出路径（相对 CLI 工作目录或绝对）；打印最终路径，不覆盖文件。
 * --out: required JSON path relative to CLI cwd or absolute; prints the final path, never overwrites.
 * --issue：可选，仅导出指定当前有效问题；省略时导出全部当前问题。
 * --issue: optional current issue ID; omitted means all current issues in the run.
 * 示例 / Example: pnpm data issues export RUN123 --out diagnostics.json
 * 示例 / Example: pnpm data issues export RUN123 --issue ISSUE123 --out one-issue.json
 *
 * pnpm data issues repair --plan FILE [--apply --expect-plan PLAN_HASH]
 * FILE：issues export 提供 repairContract 和各问题模板，计划为 {runId, actions}。
 * FILE: a {runId, actions} JSON plan built from the export's repairContract and issue templates.
 * 默认只读预览。--apply 与 --expect-plan 同时使用，提交已确认的预览。
 * Preview is read-only. Use --apply and --expect-plan together to apply a reviewed preview.
 *
 * pnpm data reset [--database /absolute/path.db] [--apply]
 * --database：可选绝对路径；--apply 才备份并执行清理，否则仅预览。
 * --database: optional absolute path; --apply backs up and resets, otherwise preview only.
 * pnpm data etf list | select-top [--limit 100] | add CODE | remove CODE
 * pnpm data index list | add CODE | remove CODE
 * CODE：来源证券代码；--limit：ETF Top N，1 至 5000，默认 100。
 * CODE: provider security code; --limit: ETF Top N, 1 through 5000, default 100.
 * --help：显示帮助，不加载数据库或数据源。
 * --help: show usage without loading the database or providers.
 */
export type DataRequest =
  | { action: 'help' }
  | { action: 'ingest'; targetDate?: string }
  | { action: 'reset'; apply: boolean; database?: string }
  | { action: 'runs'; limit: number }
  | { action: 'issues'; runId: string }
  | { action: 'reconcile-issues'; runId?: string }
  | { action: 'export-issues'; runId: string; output: string; issueId?: string }
  | { action: 'repair-issues'; plan: string; expectedHash?: string }
  | { action: 'list'; assetType: 'etf' | 'index' }
  | { action: 'add' | 'remove'; assetType: 'etf' | 'index'; code: string }
  | { action: 'select-top'; assetType: 'etf'; limit: number };

const usage = [
  'Usage: pnpm data ingest [--to YYYYMMDD]',
  '       pnpm data runs [--limit N]',
  'Runs: default 5, range 1-100; id/status/startedAt/finishedAt only; newest first.',
  '       pnpm data issues RUN_ID',
  '       pnpm data issues reconcile [RUN_ID]',
  'Reconcile: create missing pending records for finished runs only; never reset handled issues.',
  '       pnpm data issues export RUN_ID --out FILE [--issue ISSUE_ID]',
  'Export: RUN_ID from runs; --out is required (relative or absolute); --issue selects one current issue.',
  'Example: pnpm data issues export RUN123 --out diagnostics.json',
  '       pnpm data issues repair --plan FILE [--apply --expect-plan PLAN_HASH]',
  'Repair: use repairContract and issue templates in the export. Default is a read-only preview.',
  '       pnpm data reset [--database /absolute/path.db] [--apply]',
  '       pnpm data etf list | select-top [--limit 100] | add CODE | remove CODE',
  '       pnpm data index list | add CODE | remove CODE',
  'Reset previews by default; --apply backs up and removes all non-login business data.',
].join('\n');

/**
 * 帮助和非法参数不加载环境或数据库。
 *
 * Help and invalid arguments never load environment or database modules.
 */
export function parseDataArguments(args: string[]): DataRequest {
  if (!args.length || args.includes('--help')) {
    return { action: 'help' };
  }
  if (args[0] === 'ingest' && args.length === 1) {
    return { action: 'ingest' };
  }
  if (
    args[0] === 'ingest' &&
    args.length === 3 &&
    args[1] === '--to' &&
    isObservationDate(args[2])
  ) {
    return { action: 'ingest', targetDate: args[2] };
  }
  if (args[0] === 'runs') {
    if (args.length === 1) {
      return { action: 'runs', limit: 5 };
    }
    if (args.length === 3 && args[1] === '--limit' && /^\d+$/.test(args[2])) {
      const limit = Number(args[2]);
      if (Number.isSafeInteger(limit) && limit >= 1 && limit <= 100) {
        return { action: 'runs', limit };
      }
    }
    throw new Error(usage);
  }
  if (args[0] === 'issues' && args[1] === 'reconcile') {
    if (args.length === 2 || (args.length === 3 && /^[A-Za-z0-9_-]+$/.test(args[2]))) {
      return { action: 'reconcile-issues', runId: args[2] };
    }
    throw new Error(usage);
  }
  if (args[0] === 'issues' && args[1] === 'repair') {
    const [, , flag, plan, apply, expect, expectedHash] = args;
    if (flag === '--plan' && plan?.trim() && !plan.startsWith('--')) {
      if (args.length === 4) {
        return { action: 'repair-issues', plan };
      }
      if (
        args.length === 7 &&
        apply === '--apply' &&
        expect === '--expect-plan' &&
        /^[a-f0-9]{64}$/.test(expectedHash)
      ) {
        return { action: 'repair-issues', plan, expectedHash };
      }
    }
    throw new Error(usage);
  }
  if (args[0] === 'issues' && args[1] === 'export') {
    if (!args[2] || !/^[A-Za-z0-9_-]+$/.test(args[2])) {
      throw new Error(usage);
    }
    const request: Extract<DataRequest, { action: 'export-issues' }> = {
      action: 'export-issues',
      runId: args[2],
      output: '',
    };
    const seen = new Set<string>();
    for (let index = 3; index < args.length; index += 2) {
      const flag = args[index];
      const value = args[index + 1];
      if (seen.has(flag) || !value || value.startsWith('--')) {
        throw new Error(usage);
      }
      seen.add(flag);
      switch (flag) {
        case '--out':
          if (!value.trim()) {
            throw new Error(usage);
          }
          request.output = value;
          break;
        case '--issue':
          if (!/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new Error(usage);
          }
          request.issueId = value;
          break;
        default:
          throw new Error(usage);
      }
    }
    if (!request.output) {
      throw new Error(usage);
    }

    return request;
  }
  if (args[0] === 'issues' && args.length === 2 && /^[A-Za-z0-9_-]+$/.test(args[1])) {
    return { action: 'issues', runId: args[1] };
  }
  if (args[0] === 'reset') {
    const request: Extract<DataRequest, { action: 'reset' }> = { action: 'reset', apply: false };
    const seen = new Set<string>();
    for (let index = 1; index < args.length; index++) {
      const flag = args[index];
      if (seen.has(flag)) {
        throw new Error(usage);
      }
      seen.add(flag);
      if (flag === '--apply') {
        request.apply = true;
      } else if (flag === '--database' && args[index + 1] && isAbsolute(args[index + 1])) {
        request.database = args[++index];
      } else {
        throw new Error(usage);
      }
    }

    return request;
  }
  const [assetType, action, code, limitValue] = args;
  if (assetType === 'etf' || assetType === 'index') {
    if (action === 'list' && args.length === 2) {
      return { action, assetType };
    }
    if (
      ['add', 'remove'].includes(action) &&
      args.length === 3 &&
      (assetType === 'etf'
        ? /^\d{6}\.(SH|SZ)$/.test(code)
        : /^(?:\d{6}|H\d{5})\.(SH|SZ|CSI)$/.test(code))
    ) {
      return { action: action as 'add' | 'remove', assetType, code };
    }
    if (
      assetType === 'etf' &&
      action === 'select-top' &&
      (args.length === 2 || (args.length === 4 && code === '--limit' && /^\d+$/.test(limitValue)))
    ) {
      const limit = args.length === 2 ? 100 : Number(limitValue);
      if (limit >= 1 && limit <= 5000) {
        return { action, assetType, limit };
      }
    }
  }
  throw new Error(usage);
}

export async function runDataCli(args: string[]): Promise<number> {
  let request: DataRequest;
  try {
    request = parseDataArguments(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (request.action === 'help') {
    console.log(usage);
    return 0;
  }
  const { executeDataCommand } = await import('./execute.js');

  return executeDataCommand(request);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runDataCli(process.argv.slice(2));
}
