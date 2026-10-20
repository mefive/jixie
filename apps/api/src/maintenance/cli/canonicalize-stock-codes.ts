import { prisma } from '#infra/database/prisma.js';
import { runStagedMaintenance } from '../staging/coordinator.js';

runStagedMaintenance('canonicalize', [])
  .catch((error: unknown) => {
    console.error(
      'canonicalize-stock-codes failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
