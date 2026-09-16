import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaPackage, { type PrismaClient } from '@prisma/client';

// Run during deployment while the API is stopped, after schema migrations.
// Preserve frozen payloads and results; kind alone determines routing afterwards.
export async function migrateLegacyFactorJobs(prisma: PrismaClient): Promise<void> {
  for (;;) {
    const migrated = await prisma.$transaction(async (transaction) => {
      const jobs = await transaction.job.findMany({
        where: { kind: 'factor' },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true, payload: true },
      });
      if (jobs.length === 0) {
        return 0;
      }

      const analysisIds: string[] = [];
      const correlationIds: string[] = [];
      for (const job of jobs) {
        const payload = job.payload;
        const correlation =
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          payload.task === 'correlation';
        (correlation ? correlationIds : analysisIds).push(job.id);
      }

      if (analysisIds.length > 0) {
        await transaction.job.updateMany({
          where: { id: { in: analysisIds }, kind: 'factor' },
          data: { kind: 'factor-analysis' },
        });
      }
      if (correlationIds.length > 0) {
        await transaction.job.updateMany({
          where: { id: { in: correlationIds }, kind: 'factor' },
          data: { kind: 'factor-correlation' },
        });
      }
      return jobs.length;
    });
    if (migrated === 0) {
      return;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prisma = new prismaPackage.PrismaClient();
  try {
    await migrateLegacyFactorJobs(prisma);
    console.log('Factor Job kinds are up to date.');
  } catch (error) {
    console.error('Factor Job kind migration failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
