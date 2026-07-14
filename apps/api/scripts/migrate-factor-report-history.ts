import type { FactorAnalysisSpecV1 } from '@jixie/shared';
import { prisma } from '../src/lib/prisma.js';
import { factorVariantKey, sha256 } from '../src/factor/report-spec.js';

const BATCH_SIZE = 100;

let migrated = 0;

try {
  while (true) {
    const reports = await prisma.factorReport.findMany({
      where: { specJson: null },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (reports.length === 0) {
      break;
    }

    const factorIds = [...new Set(reports.map((report) => report.factor))];
    const factors = await prisma.factor.findMany({
      where: { id: { in: factorIds } },
      select: { id: true, code: true },
    });
    const codeByFactor = new Map(factors.map((factor) => [factor.id, factor.code]));

    for (const report of reports) {
      const spec: FactorAnalysisSpecV1 = {
        version: 1,
        freq: report.freq as FactorAnalysisSpecV1['freq'],
        start: report.start,
        end: report.end,
        neutral: report.neutral as FactorAnalysisSpecV1['neutral'],
      };
      const factorCodeSnapshot = codeByFactor.get(report.factor);
      const factorCodeHash = factorCodeSnapshot ? sha256(factorCodeSnapshot) : undefined;

      await prisma.factorReport.updateMany({
        where: { id: report.id, specJson: null },
        data: {
          status: 'done',
          phase: 'legacy',
          specJson: JSON.stringify(spec),
          createdAt: report.computedAt ?? report.createdAt,
          factorCodeSnapshot,
          factorCodeHash,
          variantKey: factorCodeHash ? factorVariantKey(spec, factorCodeHash) : undefined,
        },
      });
      migrated += 1;
    }
  }

  const [total, withPayload, pending] = await Promise.all([
    prisma.factorReport.count(),
    prisma.factorReport.count({ where: { payload: { not: null } } }),
    prisma.factorReport.count({ where: { specJson: null } }),
  ]);
  console.log(
    `[factor-report-history] migrated=${migrated} total=${total} payload=${withPayload} pending=${pending}`,
  );
} finally {
  await prisma.$disconnect();
}
