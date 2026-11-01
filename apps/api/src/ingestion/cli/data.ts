import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isObservationDate } from '#market/synchronization/date.js';

export type DataRequest =
  | { action: 'help' }
  | { action: 'ingest'; targetDate?: string }
  | { action: 'reset'; apply: boolean; database?: string }
  | { action: 'runs' }
  | { action: 'issues'; runId: string }
  | { action: 'list'; assetType: 'etf' | 'index' }
  | { action: 'add' | 'remove'; assetType: 'etf' | 'index'; code: string }
  | { action: 'select-top'; assetType: 'etf'; limit: number };

const usage = [
  'Usage: pnpm data ingest [--to YYYYMMDD]',
  '       pnpm data runs | issues RUN_ID',
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
  if (args[0] === 'runs' && args.length === 1) {
    return { action: 'runs' };
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
