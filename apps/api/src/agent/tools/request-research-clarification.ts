import { z } from 'zod';
import { ulid } from 'ulid';
import type {
  ResearchClarificationOptionV1,
  ResearchClarificationQuestionV1,
  ResearchClarificationV1,
} from '@jixie/shared';
import { resolveResearchConceptBindings } from '../../research/concept-binding-resolver.js';
import {
  researchConceptBindingSdkCall,
  researchConceptBindingRegistry,
  type ResearchConceptBindingV1,
} from '../../research/concept-bindings.js';
import { RESEARCH_CONCEPT_IDS, researchConceptById } from '../../research/concepts.js';
import type { ResearchCatalogTurnEvidence } from './search-research-catalog.js';
import type { AgentTool } from './types.js';

const optionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('concept'), conceptId: z.enum(RESEARCH_CONCEPT_IDS) }),
  z.strictObject({ kind: z.literal('binding'), bindingId: z.string().trim().min(1).max(160) }),
  z.strictObject({ kind: z.literal('keep_gap') }),
]);
const questionSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(500),
  selectionMode: z.enum(['single', 'multiple']).default('single'),
  options: z.array(optionSchema).min(2).max(4),
  allowCustom: z.boolean().default(true),
});
const argsSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  questions: z.array(questionSchema).min(1).max(3),
});

/** Build one durable, catalog-backed user clarification card for the current Research turn. */
export function createRequestResearchClarificationTool(args: {
  documentId: string;
  catalogEvidence: ResearchCatalogTurnEvidence;
}): AgentTool {
  let clarificationCreated = false;
  return {
    name: 'requestResearchClarification',
    description:
      'Ask the user one to three structured Research questions and end this turn without proposing Python. Use this after searchResearchCatalog reports choice_required or no_exact_match, or when a material Concept dimension remains ambiguous. Every option must reference an exact canonical conceptId, an audited bindingId returned with sdkAccess.status=ready, or keep_gap. Never invent an option or use a fuzzy match as a substitute. The rendered card lets the user select an option or enter custom text; their durable answer starts a new Agent turn.',
    parameters: z.toJSONSchema(argsSchema),
    async run(input) {
      if (clarificationCreated) {
        throw new Error('Only one Research clarification is allowed per Agent turn.');
      }
      const parsed = argsSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid Research clarification: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }

      const bindingIds = [
        ...new Set(
          parsed.data.questions.flatMap((question) =>
            question.options.flatMap((option) =>
              option.kind === 'binding' ? [option.bindingId] : [],
            ),
          ),
        ),
      ];
      const bindings = bindingIds.map((bindingId) => {
        const binding = researchConceptBindingRegistry.bindings.find(
          (candidate) => candidate.id === bindingId,
        );
        if (!binding) {
          throw new Error(`Unknown Research binding ${bindingId}.`);
        }
        if (!args.catalogEvidence.sdkReadyBindingIds.has(bindingId)) {
          throw new Error(
            `Research binding ${bindingId} was not returned as SDK-ready by searchResearchCatalog in this turn.`,
          );
        }
        return binding;
      });
      const availability = await resolveResearchConceptBindings(bindings);
      const unavailable = availability.filter(
        (result) => !result.available || !researchConceptBindingSdkCall(result.binding),
      );
      if (unavailable.length > 0) {
        throw new Error(
          `Research bindings are not executable through the public Research SDK: ${unavailable
            .map((result) => result.binding.id)
            .join(', ')}.`,
        );
      }

      const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
      const questions = parsed.data.questions.map((question): ResearchClarificationQuestionV1 => {
        const references = question.options.map(optionReference);
        if (new Set(references).size !== references.length) {
          throw new Error('Research clarification options must be unique within each question.');
        }
        return {
          id: ulid(),
          prompt: question.prompt,
          selectionMode: question.selectionMode,
          options: question.options.map((option) => clarificationOption(option, bindingById)),
          allowCustom: question.allowCustom,
        };
      });
      const clarification: ResearchClarificationV1 = {
        version: 1,
        id: ulid(),
        documentId: args.documentId,
        title: parsed.data.title,
        status: 'pending',
        questions,
        createdAt: new Date().toISOString(),
      };
      clarificationCreated = true;
      return {
        observation: JSON.stringify({
          clarificationId: clarification.id,
          status: clarification.status,
          questionCount: clarification.questions.length,
          userActionRequired: true,
          proposedCellChanges: false,
        }),
        rows: clarification.questions.length,
        researchClarification: clarification,
      };
    },
  };
}

function clarificationOption(
  option: z.infer<typeof optionSchema>,
  bindingById: Map<string, ResearchConceptBindingV1>,
): ResearchClarificationOptionV1 {
  switch (option.kind) {
    case 'concept': {
      const concept = researchConceptById.get(option.conceptId)!;
      return {
        id: `concept:${concept.id}`,
        kind: 'concept',
        referenceId: concept.id,
        labelZh: concept.nameZh,
        labelEn: concept.nameEn,
        descriptionZh: concept.descriptionZh,
        descriptionEn: concept.descriptionEn,
      };
    }
    case 'binding': {
      const binding = bindingById.get(option.bindingId)!;
      return {
        id: `binding:${binding.id}`,
        kind: 'binding',
        referenceId: binding.id,
        labelZh: binding.nameZh,
        labelEn: binding.nameEn,
        descriptionZh: binding.selectionNoteZh,
        descriptionEn: binding.selectionNoteEn,
      };
    }
    case 'keep_gap':
      return {
        id: 'keep_gap',
        kind: 'keep_gap',
        labelZh: '不使用代理',
        labelEn: 'Do not substitute',
        descriptionZh: '保留原研究定义，并将当前平台数据缺口明确记录在研究文档中。',
        descriptionEn:
          'Keep the original research definition and record the current platform data gap explicitly.',
      };
  }
}

function optionReference(option: z.infer<typeof optionSchema>): string {
  switch (option.kind) {
    case 'concept':
      return `concept:${option.conceptId}`;
    case 'binding':
      return `binding:${option.bindingId}`;
    case 'keep_gap':
      return 'keep_gap';
  }
}
