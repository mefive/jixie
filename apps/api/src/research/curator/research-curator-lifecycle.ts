import { researchCuratorJobPayloadSchema } from './job-payload.js';
import type { JobLifecycle } from '#jobs/lifecycle.js';
import { prepareResearchCuratorRun } from './prepare.js';

export const researchCuratorLifecycle = {
  async onExecute(job, log) {
    const input = researchCuratorJobPayloadSchema.parse(job.payload);
    if (input.runId !== job.researchCuratorRunId) {
      throw new Error('Curator payload does not match its persisted run');
    }
    log({
      source: 'system',
      level: 'info',
      text: 'Extracting owner-scoped research evidence.',
    });
    const output = await prepareResearchCuratorRun(input.runId);
    log({
      source: 'system',
      level: 'info',
      text: `Prepared ${output.findings.length} finding candidate(s).`,
    });

    return output;
  },
  async onSuccess(transaction, job, output) {
    if (output.runId !== job.researchCuratorRunId || output.userId !== job.userId) {
      throw new Error('Curator result does not match its persisted owner or run');
    }
    // Recheck deduplication at publication time, including duplicates within this batch.
    const existing = await transaction.researchCuratorFinding.findMany({
      where: {
        userId: job.userId,
        fingerprint: { in: output.findings.map((finding) => finding.fingerprint) },
      },
      select: { fingerprint: true },
    });
    const seen = new Set(existing.map((finding) => finding.fingerprint));
    const findings = output.findings.filter((finding) => {
      if (seen.has(finding.fingerprint)) {
        return false;
      }
      seen.add(finding.fingerprint);
      return true;
    });
    if (findings.length > 0) {
      await transaction.researchCuratorFinding.createMany({ data: findings });
    }
    await transaction.researchCuratorRun.update({
      where: { id: output.runId, userId: job.userId },
      data: {
        evidenceCount: output.evidenceCount,
        findingsCreated: findings.length,
        duplicatesSkipped: output.findings.length - findings.length,
      },
    });
  },
} satisfies JobLifecycle<Awaited<ReturnType<typeof prepareResearchCuratorRun>>>;
