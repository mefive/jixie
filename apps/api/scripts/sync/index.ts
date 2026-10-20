import { pathToFileURL } from 'node:url';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadEnvFile } from 'node:process';
import { runCommandEntry } from '../command-entry.js';
import { parseSyncArguments } from './arguments.js';
import { syncCommands } from './commands.js';

const directEntry = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
);

async function main(): Promise<void> {
  const request = parseSyncArguments(process.argv.slice(2));
  if (request.action === 'run' && !isStagingDatabase()) {
    const directory = new URL(
      import.meta.url.endsWith('.ts') ? '../../' : '../../../',
      import.meta.url,
    );
    loadEnvFile(new URL('.env', directory));
    const { runStagedMaintenance } = await import('#maintenance/staging/coordinator.js');
    try {
      await runStagedMaintenance('sync', process.argv.slice(2));
    } finally {
      const { prisma } = await import('#infra/database/prisma.js');
      await prisma.$disconnect();
    }
    return;
  }
  await runCommandEntry({
    family: 'sync',
    commands: syncCommands,
    request,
    notes:
      "Dates: YYYYMMDD; macro months: YYYYMM. Omitted arguments retain each task's existing defaults (some use 2024). Specify a range for targeted imports. Running a task writes market data; maintenance and import:data remain separate orchestration commands.",
  });
}

await main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (directEntry) {
      if (isStagingDatabase()) {
        const { prisma, closeStagingIPC } = await import('#infra/database/prisma.js');
        await prisma.$disconnect();
        closeStagingIPC();
      }
    }
  });
