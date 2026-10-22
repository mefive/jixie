import { prisma, withDatabase, closeDatabase } from '#infra/database/prisma.js';
import { MarketAccessBusyError } from '#infra/coordination/market-access.js';
import { runStagedMaintenance } from '../staging/coordinator.js';
import { cleanupMaintenanceArtifacts } from '../staging/cleanup.js';

type MaintenanceCommand = 'daily' | 'weekly' | 'repair';

async function main(): Promise<void> {
  const [first, ...remaining] = process.argv.slice(2);
  if (first === 'cleanup') {
    if (remaining.some((argument) => argument !== '--apply') || remaining.length > 1) {
      throw new Error('Usage: pnpm maintenance cleanup [--apply]');
    }
    const result = await cleanupMaintenanceArtifacts({ apply: remaining.includes('--apply') });
    console.log(JSON.stringify(result, null, 2));
    if (result.candidates.some((candidate) => candidate.error)) {
      process.exitCode = 1;
    }
    return;
  }
  const command =
    first === 'sync' || first === 'canonicalize' || first === 'import'
      ? first
      : maintenanceCommand(first);
  const args = command === 'daily' && first !== 'daily' ? process.argv.slice(2) : remaining;
  await runStagedMaintenance(command, args);
}

/**
 * 解析维护子命令并校验支持范围。
 *
 * Resolve and validate a maintenance subcommand.
 */
function maintenanceCommand(argument: string | undefined): MaintenanceCommand {
  if (!argument || argument === 'daily' || argument.startsWith('--') || /^\d{8}$/.test(argument)) {
    return 'daily';
  }
  if (argument === 'weekly' || argument === 'repair') {
    return argument;
  }

  throw new Error(
    'Usage: pnpm maintenance [daily [YYYYMMDD] [--force] | weekly [--force] | repair YYYYMMDD YYYYMMDD]',
  );
}

await withDatabase(prisma, main)
  .catch((error: unknown) => {
    if (error instanceof MarketAccessBusyError) {
      process.exitCode = 75;
      return;
    }
    console.error('[maintenance] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabase(prisma));
