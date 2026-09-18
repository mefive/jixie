import { probeCommands, parseProbeArguments } from './probe-commands.js';
import { runCommandEntry } from './command-entry.js';

async function main(): Promise<void> {
  await runCommandEntry({
    family: 'probe',
    commands: probeCommands,
    request: parseProbeArguments(process.argv.slice(2)),
    notes:
      'Execution uses API .env and may contact external providers. Only asset-allocation persistence flags write database records. No task runs when arguments are omitted.',
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
