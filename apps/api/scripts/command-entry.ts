import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export interface CommandDefinition {
  name: string;
  entry: string;
  usage: string;
  description: string;
}

export type CommandRequest<Command extends CommandDefinition = CommandDefinition> =
  | { action: 'help'; command?: Command }
  | { action: 'run'; command: Command; args: string[] };

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

interface CommandEntryOptions {
  family: string;
  commands: CommandDefinition[];
  request: CommandRequest;
  notes: string;
}

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
