import { z } from 'zod';
import {
  RESEARCH_PLAYBOOK_IDS,
  playbookConceptDefinitions,
  researchPlaybookById,
} from '../../research/playbooks.js';
import type { AgentTool } from './types.js';

const argsSchema = z.strictObject({
  playbookId: z.enum(RESEARCH_PLAYBOOK_IDS),
});

/** Load one versioned domain workflow without putting every research direction in the base prompt. */
export const loadResearchPlaybookTool: AgentTool = {
  name: 'loadResearchPlaybook',
  description:
    'Load a versioned domain research playbook by its exact registered id. A playbook provides candidate concept ids, workflow, common hypothesis directions, and non-substitution rules. It never supplies or validates a database entity id; pass its concept ids to searchResearchCatalog for exact local resolution.',
  parameters: z.toJSONSchema(argsSchema),
  async run(args) {
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const playbook = researchPlaybookById.get(parsed.data.playbookId)!;
    const conceptDefinitions = playbookConceptDefinitions(playbook).map((concept) => ({
      id: concept.id,
      version: concept.version,
      nameZh: concept.nameZh,
      nameEn: concept.nameEn,
      descriptionZh: concept.descriptionZh,
      descriptionEn: concept.descriptionEn,
      doNotSubstitute: concept.doNotSubstitute,
    }));

    return {
      observation: JSON.stringify({
        registryVersion: 1,
        playbook,
        conceptDefinitions,
      }),
      rows: conceptDefinitions.length,
    };
  },
};
