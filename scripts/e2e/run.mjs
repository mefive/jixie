import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2eCommands } from './commands.mjs';
import { signalProcessGroup, waitForServiceExit } from '../dev/process-group.mjs';

const repositoryDirectory = fileURLToPath(new URL('../../', import.meta.url));

export function selectCommands(input, commands) {
  const args = input[0] === '--' ? input.slice(1) : input;
  if (!args.length || (args.length === 1 && ['--help', '-h', '--list'].includes(args[0]))) {
    return { list: true, commands };
  }
  if (args[0] === '--group' && (args.length === 2 || (args.length === 3 && args[2] === '--list'))) {
    const selected = commands.filter((command) => command.group === args[1]);
    if (!selected.length) {
      throw new Error(`Unknown group: ${args[1]}`);
    }
    return { list: args[2] === '--list', commands: selected };
  }
  if (args.length === 1 || (args.length === 2 && ['--help', '-h'].includes(args[1]))) {
    const command = commands.find((candidate) => candidate.name === args[0]);
    if (command) {
      return { list: args.length === 2, commands: [command] };
    }
  }
  throw new Error(
    'Unknown task or arguments. Use --list, TASK, TASK --help, or --group GROUP [--list].',
  );
}

export async function runCommands(commands, execute = executeCommand, report = console.log) {
  let completed = 0;
  for (const command of commands) {
    report(`\n[${completed + 1}/${commands.length}] ${command.name}`);
    let code;
    try {
      code = await execute(command);
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
      code = 1;
    }
    if (code !== 0) {
      report(
        `FAIL ${command.name} (exit ${code}); ${completed} passed, ${commands.length - completed - 1} not run.`,
      );
      return code;
    }
    completed += 1;
    report(`PASS ${command.name}`);
  }
  report(`\n${completed}/${commands.length} passed.`);
  return 0;
}

export async function executeCommand(command) {
  const entry = resolve(repositoryDirectory, command.file);
  const child = spawn(process.execPath, [...(command.nodeArgs ?? []), entry], {
    cwd: dirname(dirname(entry)),
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  let interrupted;
  let forceTimer;
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (interrupted) {
        signalProcessGroup(child, 'SIGKILL');
        return;
      }
      interrupted = signal;
      signalProcessGroup(child, signal);
      forceTimer = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), 5_000);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  let result;
  let cleanupFailed = false;
  try {
    result = await new Promise((resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveResult({ code, signal }));
    });
  } finally {
    try {
      // Reap browser/server descendants even if the script exited before cleaning them up.
      signalProcessGroup(child, 'SIGTERM');
      if (!(await waitForServiceExit(child, 1_000))) {
        signalProcessGroup(child, 'SIGKILL');
        if (!(await waitForServiceExit(child, 1_000))) {
          cleanupFailed = true;
        }
      }
    } finally {
      clearTimeout(forceTimer);
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
    }
  }
  if (cleanupFailed) {
    throw new Error(`Process group for ${command.name} did not stop.`);
  }
  const signal = interrupted ?? result.signal;
  return signal ? 128 + (constants.signals[signal] ?? 1) : (result.code ?? 1);
}

export async function runCli(name, commands, args = process.argv.slice(2)) {
  try {
    const selection = selectCommands(args, commands);
    if (selection.list) {
      console.log(
        `Usage: pnpm ${name} TASK\n       pnpm ${name} --group GROUP [--list]\n       pnpm ${name} --list\n`,
      );
      console.log(`Groups: ${[...new Set(commands.map((command) => command.group))].join(', ')}\n`);
      for (const command of selection.commands) {
        console.log(
          `  ${command.name} [${command.group}]\n    ${command.file}${command.notes ? `\n    ${command.notes}` : ''}`,
        );
      }
      console.log(
        '\nBrowser tasks need Playwright Chromium and their documented services/data. E2E_BASE and other existing environment switches are inherited.',
      );
      console.log(
        'Groups run sequentially and stop on failure. See apps/web/e2e/README.md for prerequisites and side effects.',
      );
      return 0;
    }
    return await runCommands(selection.commands);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli('e2e', e2eCommands);
}
