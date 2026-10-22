import { prisma, withDatabase, closeDatabase } from '#infra/database/prisma.js';
import { runStagedMaintenance } from '../staging/coordinator.js';

await withDatabase(prisma, () => runStagedMaintenance('canonicalize', []))
  .catch((error: unknown) => {
    console.error(
      'canonicalize-stock-codes failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => closeDatabase(prisma));
