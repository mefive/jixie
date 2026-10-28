import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isObservationDate } from '#market/synchronization/date.js';

/**
 * 解析完成后才允许加载业务环境。
 *
 * Business configuration may load only after parsing succeeds.
 */
export type DataRequest =
  | { action: 'help' }
  | { action: 'sync'; targetDate?: string }
  | { action: 'list'; assetType: 'etf' | 'index' }
  | { action: 'add' | 'remove'; assetType: 'etf' | 'index'; code: string }
  | { action: 'select-top'; assetType: 'etf'; limit: number };

const usage =
  'Usage: pnpm data sync [--to YYYYMMDD]\n       pnpm data etf list|select-top [--limit 100]|add CODE|remove CODE\n       pnpm data index list|add CODE|remove CODE';

export function parseDataArguments(args: string[]): DataRequest {
  if (
    !args.length ||
    (args.length === 1 && args[0] === '--help') ||
    (args.length === 2 && args[0] === 'sync' && args[1] === '--help')
  ) {
    return { action: 'help' };
  }
  if (args[0] === 'sync' && args.length === 1) {
    return { action: 'sync' };
  }
  if (args[0] === 'sync' && args.length === 3 && args[1] === '--to' && isObservationDate(args[2])) {
    return { action: 'sync', targetDate: args[2] };
  }
  const [assetType, action, value, limitValue] = args;
  if (assetType === 'etf' || assetType === 'index') {
    if (args.length === 2 && action === '--help') {
      return { action: 'help' };
    }
    if (args.length === 2 && action === 'list') {
      return { action, assetType };
    }
    if (
      args.length === 3 &&
      (action === 'add' || action === 'remove') &&
      (assetType === 'etf'
        ? /^\d{6}\.(SH|SZ)$/.test(value)
        : /^(?:\d{6}|H\d{5})\.(SH|SZ|CSI)$/.test(value))
    ) {
      return { action, assetType, code: value };
    }
    if (
      assetType === 'etf' &&
      action === 'select-top' &&
      (args.length === 2 || (args.length === 4 && value === '--limit' && /^\d+$/.test(limitValue)))
    ) {
      const limit = args.length === 2 ? 100 : Number(limitValue);
      if (Number.isInteger(limit) && limit >= 1 && limit <= 5000) {
        return { action, assetType, limit };
      }
    }
  }
  throw new Error(usage);
}

/**
 * 参数与帮助路径不加载数据库、供应商或环境文件。
 *
 * Argument and help paths load no database, provider or environment file.
 */
export async function runDataCli(args: string[]): Promise<number> {
  let request;
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
