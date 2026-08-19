import type { Prisma } from '@prisma/client';
import type { Locale, ResearchFactorDraftResultV1, ResearchFactorHandoffV1 } from '@jixie/shared';
import { ulid } from 'ulid';
import { BUILTIN_KEYS } from '../factor/builtin-factors.js';
import { prisma } from '../lib/prisma.js';
import { getResearchExecution } from './research-execution-records.js';
import { generateResearchFactorDraft } from './research-factor-handoff.js';

export class ResearchFactorDraftUnavailableError extends Error {}

export async function createResearchFactorDraft(
  userId: string,
  executionId: string,
  locale: Locale,
): Promise<ResearchFactorDraftResultV1 | null> {
  const existing = await prisma.factor.findFirst({
    where: { userId, sourceResearchExecutionId: executionId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      researchHandoff: true,
    },
  });
  if (existing) {
    return factorDraftResult(existing, true);
  }

  const execution = await getResearchExecution(userId, executionId);
  if (!execution) {
    return null;
  }
  if (execution.status !== 'success' || !execution.promotedAt) {
    throw new ResearchFactorDraftUnavailableError(
      'Only a sealed, successful Research Execution can create a Factor draft.',
    );
  }

  const generated = await generateResearchFactorDraft(execution, locale);
  const generatedAt = new Date();
  const handoff: ResearchFactorHandoffV1 = {
    version: 1,
    sourceExecutionId: execution.id,
    sourceDocumentId: execution.documentId,
    sourceContentRevision: execution.contentRevision,
    sourceHash: execution.sourceHash,
    sourceDisplayName: execution.displayName ?? execution.title,
    analysisKind: generated.analysisKind,
    summary: generated.summary,
    unresolvedItems: generated.unresolvedItems,
    generatedAt: generatedAt.toISOString(),
    models: {
      classifier: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      codegen: process.env.DEEPSEEK_AGENT_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    },
  };

  for (let attempt = 0; attempt < 100; attempt++) {
    const key = factorKeyCandidate(generated.factorKeyBase, attempt);
    const [factorWithKey, compositeWithKey] = await Promise.all([
      prisma.factor.findFirst({ where: { userId, key }, select: { id: true } }),
      prisma.factorComposite.findFirst({ where: { userId, key }, select: { id: true } }),
    ]);
    if (factorWithKey || compositeWithKey || BUILTIN_KEYS.has(key)) {
      continue;
    }
    try {
      const factor = await prisma.factor.create({
        data: {
          id: ulid(),
          userId,
          key,
          name: generated.factorName,
          analysisKind: generated.analysisKind,
          code: generated.code,
          messages: generated.messages as unknown as Prisma.InputJsonValue,
          sourceResearchExecutionId: execution.id,
          researchHandoff: handoff as unknown as Prisma.InputJsonValue,
          ...(locale === 'en'
            ? { descriptionEn: generated.summary }
            : { descriptionZh: generated.summary }),
        },
        select: {
          id: true,
          key: true,
          name: true,
          analysisKind: true,
          researchHandoff: true,
        },
      });
      return factorDraftResult(factor, false);
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        throw error;
      }
      const raced = await prisma.factor.findFirst({
        where: { userId, sourceResearchExecutionId: execution.id },
        select: {
          id: true,
          key: true,
          name: true,
          analysisKind: true,
          researchHandoff: true,
        },
      });
      if (raced) {
        return factorDraftResult(raced, true);
      }
    }
  }
  throw new Error('Could not allocate a unique Factor key for the research handoff.');
}

function factorKeyCandidate(requested: string, attempt: number): string {
  const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
  const base = requested.slice(0, 32 - suffix.length).replace(/_+$/g, '') || 'research_factor';
  return `${base}${suffix}`;
}

function factorDraftResult(
  factor: {
    id: string;
    key: string;
    name: string;
    analysisKind: string;
    researchHandoff: Prisma.JsonValue | null;
  },
  reused: boolean,
): ResearchFactorDraftResultV1 {
  const handoff = factor.researchHandoff as unknown as ResearchFactorHandoffV1 | null;
  if (
    !handoff ||
    handoff.version !== 1 ||
    (factor.analysisKind !== 'cross_sectional' &&
      factor.analysisKind !== 'time_series' &&
      factor.analysisKind !== 'panel')
  ) {
    throw new Error('The existing Factor draft has invalid research handoff metadata.');
  }
  return {
    version: 1,
    factorId: factor.id,
    factorKey: factor.key,
    factorName: factor.name,
    analysisKind: factor.analysisKind,
    handoff,
    reused,
  };
}
