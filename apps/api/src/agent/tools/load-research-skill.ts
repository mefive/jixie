import { z } from 'zod';
import {
  RESEARCH_SKILL_IDS,
  researchSkillById,
  skillConceptDefinitions,
} from '../../research/skills.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({
  skillId: z.enum(RESEARCH_SKILL_IDS),
});

/** Load one versioned domain workflow without putting every research direction in the base prompt. */
export const loadResearchSkillTool: AgentTool = {
  name: 'loadResearchSkill',
  description:
    'Load a versioned domain research skill by its exact registered id. A skill provides candidate concept ids, workflow, common hypothesis directions, and non-substitution rules. It never supplies or validates a database entity id; pass its concept ids to searchResearchCatalog for exact local resolution.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const skill = researchSkillById.get(parsed.data.skillId)!;
    const conceptDefinitions = skillConceptDefinitions(skill).map((concept) => ({
      id: concept.id,
      version: concept.version,
      nameZh: concept.nameZh,
      nameEn: concept.nameEn,
      descriptionZh: concept.descriptionZh,
      descriptionEn: concept.descriptionEn,
      preferredSourceKinds: concept.preferredSourceKinds,
      preferredAssetTypes: concept.preferredAssetTypes,
      doNotSubstitute: concept.doNotSubstitute,
    }));

    return {
      observation: JSON.stringify({
        registryVersion: 1,
        skill,
        conceptDefinitions,
      }),
      rows: conceptDefinitions.length,
    };
  },
};
