import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const require = createRequire(import.meta.url);
const loader = require.resolve('tsx');

async function createFixture(directory: string, compiled: boolean): Promise<string> {
  const outputDirectory = compiled ? join(directory, 'dist') : directory;
  await mkdir(join(outputDirectory, 'scripts'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  for (const name of [
    'sync/index',
    'sync/arguments',
    'sync/commands',
    'command-entry',
    'audit/index',
    'audit/commands',
    'probes/index',
    'probes/commands',
  ]) {
    const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8');
    const output = compiled
      ? ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText
      : source;
    const outputPath = join(outputDirectory, 'scripts', `${name}.${compiled ? 'js' : 'ts'}`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
  }
  return outputDirectory;
}

const commandCases = [
  {
    entry: 'sync/index',
    family: 'sync',
    task: 'stock-prices',
    target: 'src/market/cli/sync-stock-prices',
    args: ['20250101', '20251231'],
  },
  {
    entry: 'audit/index',
    family: 'data:audit',
    task: 'valuation-samples',
    target: 'scripts/audit/audit-valuation-samples',
    args: ['20250101', 'output with spaces.json'],
  },
  {
    entry: 'probes/index',
    family: 'probe',
    task: 'asset-allocation',
    target: 'scripts/probes/probe-asset-allocation',
    args: ['--date', '20250101', '--json', '--persist-if-stale'],
  },
].flatMap((command) => [false, true].map((compiled) => ({ ...command, compiled })));

describe('API command executable boundary', () => {
  it.each(commandCases)(
    'help and invalid input do not require .env or business modules ($family, compiled=$compiled)',
    async (command) => {
      const { compiled } = command;
      const directory = await mkdtemp(join(tmpdir(), 'jixie-sync-help-'));
      try {
        const outputDirectory = await createFixture(directory, compiled);
        const entry = join(
          outputDirectory,
          'scripts',
          `${command.entry}.${compiled ? 'js' : 'ts'}`,
        );
        const options = compiled ? [] : ['--conditions=development', '--import', loader];
        for (const args of [[], ['--list'], [command.task, '--help']]) {
          const result = await executeFile(process.execPath, [...options, entry, ...args], {
            cwd: tmpdir(),
            timeout: 10_000,
          });
          expect(result.stdout).toContain(`Usage: pnpm ${command.family}`);
        }
        for (const args of [['typo'], [command.task, '--typo']]) {
          await expect(
            executeFile(process.execPath, [...options, entry, ...args], {
              cwd: tmpdir(),
              timeout: 10_000,
            }),
          ).rejects.toMatchObject({ code: 1 });
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.each(commandCases)(
    'loads the API environment and forwards args to the selected entry ($family, compiled=$compiled)',
    async (command) => {
      const { compiled } = command;
      const directory = await mkdtemp(join(tmpdir(), 'jixie-sync-dispatch-'));
      try {
        const outputDirectory = await createFixture(directory, compiled);
        const extension = compiled ? 'js' : 'ts';
        await mkdir(dirname(join(outputDirectory, command.target)), { recursive: true });
        await writeFile(join(directory, '.env'), 'JIXIE_COMMAND_FIXTURE=from-api-env\n');
        await writeFile(
          join(outputDirectory, `${command.target}.${extension}`),
          `
console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), value: process.env.JIXIE_COMMAND_FIXTURE }));
process.exitCode = 7;
`,
        );
        const options = compiled ? [] : ['--conditions=development', '--import', loader];
        const environment = { ...process.env };
        delete environment.JIXIE_COMMAND_FIXTURE;
        const expected = {
          cwd: await realpath(directory),
          args: command.args,
          value: 'from-api-env',
        };
        await expect(
          executeFile(
            process.execPath,
            [
              ...options,
              join(outputDirectory, 'scripts', `${command.entry}.${extension}`),
              command.task,
              ...expected.args,
            ],
            {
              cwd: tmpdir(),
              env: environment,
              timeout: 10_000,
            },
          ),
        ).rejects.toMatchObject({ code: 7, stdout: `${JSON.stringify(expected)}\n` });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    15_000,
  );
});
