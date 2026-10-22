import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import type { CommandDefinition, CommandRequest } from '#infra/cli/arguments.js';
export {
  parseCommandArguments,
  validateDateRange,
  type CommandDefinition,
  type CommandRequest,
} from '#infra/cli/arguments.js';

/**
 * 配置 CLI 命令集合、帮助与退出处理。
 *
 * Configure CLI command registration, help and exit handling.
 */
interface CommandEntryOptions {
  family: string;
  commands: CommandDefinition[];
  request: CommandRequest;
  notes: string;
}

/**
 * 解析并验证命令后动态加载对应实现，统一处理帮助、错误与退出。
 *
 * Validate a command before dynamically loading its implementation and handling help, errors and exit.
 */
export async function runCommandEntry(options: CommandEntryOptions): Promise<void> {
  const { family, commands, request, notes } = options;
  if (request.action === 'help') {
    console.log(
      `Usage: pnpm ${family} TASK [arguments]\n       pnpm ${family} --list\n       pnpm ${family} TASK --help\n`,
    );
    for (const command of request.command ? [request.command] : commands) {
      console.log(`  ${command.name} ${command.usage}\n    ${command.description}`);
    }
    console.log(`\n${notes}`);
    return;
  }

  // Source and compiled entry points resolve their own CLI files, while configuration stays in apps/api.
  const apiDirectory = new URL(import.meta.url.endsWith('.ts') ? '../' : '../../', import.meta.url);
  const entry = new URL(`../${request.command.entry}`, import.meta.url);
  process.chdir(fileURLToPath(apiDirectory));
  loadEnvFile(new URL('.env', apiDirectory));
  process.argv = [process.execPath, fileURLToPath(entry), ...request.args];
  await import(entry.href);
}
