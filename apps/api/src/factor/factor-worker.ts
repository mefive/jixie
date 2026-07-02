import { parentPort, workerData } from 'node:worker_threads';
import type { FactorFreq } from '@jixie/shared';
import { analyzeFactor } from './analysis.js';
import { prisma } from '../lib/prisma.js';

/**
 * Factor-analysis worker thread. analyzeFactor loads whole-market panels + tight cross-sectional loops,
 * which would block the HTTP event loop, so it runs here (own PrismaClient per thread). Streams progress
 * as { type:'log', line }; on success upserts the per-user FactorReport cache (the entity holds the
 * result) and posts { type:'done' }; on failure posts { type:'error', message }. Dev (tsx) loads via the
 * .boot.mjs bootstrap; prod spawns the compiled .js.
 */
const port = parentPort;
if (!port) throw new Error('factor-worker must be spawned as a worker thread');

const { userId, factor, freq, start, end } = workerData as {
  userId: string;
  factor: string;
  freq: FactorFreq;
  start: string;
  end: string;
};

try {
  const report = await analyzeFactor(factor, freq, start, end, (line) =>
    port.postMessage({ type: 'log', line }),
  );
  const id = `${userId}|${factor}|${freq}|${start}|${end}`;
  const payload = JSON.stringify(report);
  await prisma.factorReport.upsert({
    where: { id },
    create: { id, userId, factor, freq, start, end, payload, computedAt: new Date() },
    update: { payload, computedAt: new Date() },
  });
  port.postMessage({ type: 'done' });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
