import { runCommandEntry } from '../command-entry.js';
import { parseSyncArguments } from './arguments.js';
import { syncCommands } from './commands.js';

async function main(): Promise<void> {
  await runCommandEntry({
    family: 'sync',
    commands: syncCommands,
    request: parseSyncArguments(process.argv.slice(2)),
    notes:
      "Dates: YYYYMMDD; macro months: YYYYMM. Omitted arguments retain each task's existing defaults (some use 2024). Specify a range for targeted imports. Running a task writes market data; maintenance and import:data remain separate orchestration commands.",
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
