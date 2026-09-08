import { z } from 'zod';
import { defineJob } from '../infra/jobs/definition.js';
import { prepareResearchCuratorRun } from './curator.js';

const payloadSchema = z.strictObject({ runId: z.string().min(1) });

export const researchCuratorJob = defineJob({
  parse(raw, job) {
    const input = payloadSchema.parse(raw);
    if (input.runId !== job.researchCuratorRunId) {
      throw new Error('Curator payload does not match its persisted run');
    }
    return input;
  },
  async execute(context, input) {
    context.log({
      source: 'system',
      level: 'info',
      text: 'Extracting owner-scoped research evidence.',
    });
    const result = await prepareResearchCuratorRun(input.runId);
    context.log({
      source: 'system',
      level: 'info',
      text: `Prepared ${result.findings.length} finding candidate(s).`,
    });
    return result;
  },
  async complete(transaction, job, input, output) {
    if (output.runId !== input.runId || output.userId !== job.userId) {
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
      where: { id: input.runId, userId: job.userId, status: 'running' },
      data: {
        status: 'done',
        error: null,
        evidenceCount: output.evidenceCount,
        findingsCreated: findings.length,
        duplicatesSkipped: output.findings.length - findings.length,
      },
    });
  },
  async fail(transaction, jobs, failure) {
    for (const job of jobs) {
      const id = job.researchCuratorRunId;
      if (!id) {
        continue;
      }
      await transaction.researchCuratorRun.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: { status: 'error', error: failure.message },
      });
    }
  },
  async recover(transaction, jobs) {
    const ids = jobs.map((job) => job.researchCuratorRunId).filter((id): id is string => !!id);
    if (ids.length > 0) {
      await transaction.researchCuratorRun.updateMany({
        where: { id: { in: ids }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
  },
});
