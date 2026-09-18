import { prisma } from '#infra/database/prisma.js';

export async function waitForRunningWork(onLog: (line: string) => void): Promise<void> {
  const timeoutMilliseconds = Number(process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS ?? 120_000);
  const quietMilliseconds = Number(process.env.MAINTENANCE_JOB_QUIET_MS ?? 5_000);
  const deadline = Date.now() + timeoutMilliseconds;
  let quietSince: number | null = null;

  for (;;) {
    const [jobs, agentTurns, factorWeatherRuns] = await Promise.all([
      prisma.job.count({ where: { status: { in: ['queued', 'running'] } } }),
      prisma.agentTurn.count({ where: { status: 'running' } }),
      prisma.factorWeatherPin.count({ where: { status: 'running' } }),
    ]);
    if (jobs + agentTurns + factorWeatherRuns === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMilliseconds) {
        return;
      }
    } else {
      quietSince = null;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${jobs} background jobs, ${agentTurns} Agent turns, and ${factorWeatherRuns} factor weather runs`,
      );
    }
    if (jobs + agentTurns + factorWeatherRuns > 0) {
      onLog(
        `Waiting for ${jobs} background jobs, ${agentTurns} Agent turns, and ${factorWeatherRuns} factor weather runs`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export function assertProductionLock(): void {
  if (process.env.NODE_ENV === 'production' && process.env.JIXIE_MAINTENANCE_LOCK_HELD !== '1') {
    throw new Error('Production maintenance must run through the flock-protected systemd service');
  }
}
