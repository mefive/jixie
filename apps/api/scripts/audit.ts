import { auditCommands, parseAuditArguments } from './audit-commands.js';
import { runCommandEntry } from './command-entry.js';

async function main(): Promise<void> {
  await runCommandEntry({
    family: 'data:audit',
    commands: auditCommands,
    request: parseAuditArguments(process.argv.slice(2)),
    notes:
      'Dates use YYYYMMDD. These tasks do not write database records; valuation-samples writes its output file. pnpm audit remains the package vulnerability checker.',
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
