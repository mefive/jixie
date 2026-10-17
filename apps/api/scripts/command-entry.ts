import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * 声明 CLI 命令的名称、参数与实现入口，供统一命令解析。
 * Define command metadata and argument rules for shared CLI dispatch.
 */
export interface CommandDefinition {
  name: string;
  entry: string;
  usage: string;
  description: string;
}

/**
 * 承载已解析命令及参数，供延迟加载业务实现。
 * Carry a parsed command and arguments into its deferred implementation.
 */
export type CommandRequest<Command extends CommandDefinition = CommandDefinition> =
  | { action: 'help'; command?: Command }
  | { action: 'run'; command: Command; args: string[] };

/**
 * 按命令定义解析位置参数与选项，供各模块 CLI 共用。
 * Parse positional arguments and options against command definitions.
 */
export function parseCommandArguments<Command extends CommandDefinition>(
  family: string,
  commands: Command[],
  input: string[],
  validate: (command: Command, args: string[]) => void,
): CommandRequest<Command> {
  const args = input[0] === '--' ? input.slice(1) : input;
  const [name, ...parameters] = args;
  if (!name || ['--help', '-h', '--list'].includes(name)) {
    if (parameters.length) {
      throw new Error(`Usage: pnpm ${family} [--help | --list | TASK [arguments]]`);
    }
    return { action: 'help' };
  }

  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    throw new Error(`Unknown ${family} task: ${name}. Use pnpm ${family} --list.`);
  }
  if (parameters.length === 1 && ['--help', '-h'].includes(parameters[0])) {
    return { action: 'help', command };
  }
  validate(command, parameters);
  return { action: 'run', command, args: parameters };
}

/**
 * 配置 CLI 命令集合、帮助与退出处理。
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

/**
 * 校验紧凑交易日期范围，防止格式错误或倒序输入。
 * Validate compact trading-date bounds and reject malformed or reversed ranges.
 */
export function validateDateRange(values: string[], months = false): void {
  for (const value of values) {
    const pattern = months ? /^\d{6}$/ : /^\d{8}$/;
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${months ? '01' : value.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !pattern.test(value) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw new Error(`Invalid ${months ? 'YYYYMM month' : 'YYYYMMDD date'}: ${value}`);
    }
  }
  if (values.length === 2 && values[0] > values[1]) {
    throw new Error('start must not exceed end');
  }
}
