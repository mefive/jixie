import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isObservationDate } from '#market/synchronization/date.js';

/**
 * 解析完成后才允许加载业务环境。
 *
 * Business configuration may load only after parsing succeeds.
 */
export type DataRequest = { action: 'help' } | { action: 'sync'; targetDate?: string };

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
  throw new Error('Usage: pnpm data sync [--to YYYYMMDD]');
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
    console.log('Usage: pnpm data sync [--to YYYYMMDD]\n       pnpm data sync --help');
    return 0;
  }

  const { executeDataSync } = await import('./execute.js');

  return executeDataSync(request.targetDate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runDataCli(process.argv.slice(2));
}
