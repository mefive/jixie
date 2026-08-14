import { prisma } from '../src/lib/prisma.js';
import { migrateResearchRecords } from '../src/research/records.js';

try {
  const summary = await migrateResearchRecords(prisma);
  console.log(`[research-records] ${JSON.stringify(summary)}`);
} finally {
  await prisma.$disconnect();
}
