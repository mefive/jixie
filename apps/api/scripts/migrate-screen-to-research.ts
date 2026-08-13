import { prisma } from '../src/lib/prisma.js';
import { migrateScreenDataToResearch } from '../src/research/screen-data-migration.js';

const dryRun = process.argv.includes('--dry-run');
const finalize = process.argv.includes('--finalize');

try {
  const summary = await migrateScreenDataToResearch(prisma, { dryRun, finalize });
  if (summary.deferred) {
    console.log('[screen-research] target Agent tables are not available yet; deferring migration');
  } else if (!summary.sourceTablesPresent) {
    console.log('[screen-research] legacy Screen tables do not exist; nothing to migrate');
  } else {
    console.log(`[screen-research] ${JSON.stringify(summary)}`);
  }
} finally {
  await prisma.$disconnect();
}
