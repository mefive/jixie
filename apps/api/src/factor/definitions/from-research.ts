import type { Prisma } from '@prisma/client';
import type {
  ChatMessage,
  Locale,
  ResearchFactorDraftAnalysisKindV1,
  ResearchFactorDraftResultV1,
  ResearchFactorHandoffV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import { BUILTIN_KEYS } from './builtin-factors.js';

export interface FactorDraftFromResearchInput {
  sourceExecutionId: string;
  factorKeyBase: string;
  factorName: string;
  analysisKind: ResearchFactorDraftAnalysisKindV1;
  language: 'python';
  code: string;
  messages: ChatMessage[];
  handoff: ResearchFactorHandoffV1;
  locale: Locale;
}

export async function findResearchFactorDraft(
  userId: string,
  executionId: string,
): Promise<ResearchFactorDraftResultV1 | null> {
  const existing = await prisma.factor.findFirst({
    where: { userId, sourceResearchExecutionId: executionId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      researchHandoff: true,
    },
  });

  return existing ? factorDraftResult(existing, true) : null;
}

export async function createFactorDraftFromResearch(
  userId: string,
  input: FactorDraftFromResearchInput,
): Promise<ResearchFactorDraftResultV1> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const key = factorKeyCandidate(input.factorKeyBase, attempt);
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
          name: input.factorName,
          analysisKind: input.analysisKind,
          language: input.language,
          runtimeVersion: 'py-v1',
          code: input.code,
          messages: input.messages as unknown as Prisma.InputJsonValue,
          sourceResearchExecutionId: input.sourceExecutionId,
          researchHandoff: input.handoff as unknown as Prisma.InputJsonValue,
          ...(input.locale === 'en'
            ? { descriptionEn: input.handoff.summary }
            : { descriptionZh: input.handoff.summary }),
        },
        select: {
          id: true,
          key: true,
          name: true,
          analysisKind: true,
          language: true,
          researchHandoff: true,
        },
      });
      return factorDraftResult(factor, false);
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        throw error;
      }
      const raced = await findResearchFactorDraft(userId, input.sourceExecutionId);
      if (raced) {
        return raced;
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
    language: string;
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
    language: factor.language === 'python' ? 'python' : 'typescript',
    handoff,
    reused,
  };
}
