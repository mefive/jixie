import type { FactorAnalysisSpecV1, FactorResearchIntentV1 } from '@jixie/shared';
import { factorTestKey } from '../src/factor/report-spec.js';
import { prisma } from '../src/lib/prisma.js';

const exploratoryIntent: FactorResearchIntentV1 = {
  version: 1,
  mode: 'exploratory',
  expectedDirection: 'unknown',
};

let migrated = 0;

try {
  const reports = await prisma.factorReport.findMany({
    where: { testKey: null, factorCodeHash: { not: null }, specJson: { not: null } },
  });
  for (const report of reports) {
    try {
      const spec = JSON.parse(report.specJson!) as FactorAnalysisSpecV1;
      await prisma.factorReport.updateMany({
        where: { id: report.id, testKey: null },
        data: { testKey: factorTestKey(spec, report.factorCodeHash!, exploratoryIntent) },
      });
      migrated += 1;
    } catch {
      // Preserve malformed legacy rows instead of inventing a research identity.
    }
  }
  console.log(`[factor-research-discipline] migrated=${migrated} total=${reports.length}`);
} finally {
  await prisma.$disconnect();
}
