import { prisma } from '#infra/database/prisma.js';
import { canonicalizeStockCodes } from '#maintenance/canonicalize-stock-codes.js';

canonicalizeStockCodes()
  .catch((error: unknown) => {
    console.error(
      'canonicalize-stock-codes failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
