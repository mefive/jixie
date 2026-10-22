import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { runCommandEntry } from '../command-entry.js';
import { parseSyncArguments } from './arguments.js';
import { syncCommands } from './commands.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const request = parseSyncArguments(args);
  if (request.action === 'help') {
    await runCommandEntry({
      family: 'sync',
      commands: syncCommands,
      request,
      notes:
        'Dates: YYYYMMDD; macro months: YYYYMM. Tasks prepare an isolated candidate and publish it after audit.',
    });
    return;
  }

  const directory = new URL(
    import.meta.url.endsWith('.ts') ? '../../' : '../../../',
    import.meta.url,
  );
  process.chdir(fileURLToPath(directory));
  loadEnvFile(new URL('.env', directory));
  const { prisma, withDatabase, closeDatabase } = await import('#infra/database/prisma.js');
  const { runStagedMaintenance } = await import('#maintenance/staging/coordinator.js');
  try {
    await withDatabase(prisma, () => runStagedMaintenance('sync', args));
  } finally {
    await closeDatabase(prisma);
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
