import { prisma } from '../src/lib/prisma.js';

const result = await prisma.$transaction(async (transaction) => {
  const messages = await transaction.$executeRaw`
    DELETE FROM "AgentMessage"
    WHERE EXISTS (
      SELECT 1
      FROM json_each("AgentMessage"."parts") AS part
      WHERE json_extract(part.value, '$.type') = 'research'
         OR (
           json_extract(part.value, '$.type') = 'research_cell_change'
           AND EXISTS (
             SELECT 1
             FROM json_each(json_extract(part.value, '$.proposal.operations')) AS operation
             WHERE json_extract(operation.value, '$.cellKind') = 'validation'
           )
         )
    )
  `;
  const proposals = await transaction.$executeRaw`
    DELETE FROM "ResearchCellChangeProposal"
    WHERE EXISTS (
      SELECT 1
      FROM json_each("ResearchCellChangeProposal"."operations") AS operation
      WHERE json_extract(operation.value, '$.cellKind') = 'validation'
    )
  `;
  const cellExecutions = await transaction.$executeRaw`
    DELETE FROM "ResearchCellExecution"
    WHERE "sourceKind" = 'validation'
       OR "cellId" IN (SELECT "id" FROM "ResearchCell" WHERE "kind" = 'validation')
       OR "researchExecutionId" IN (
         SELECT execution."id"
         FROM "ResearchExecution" AS execution, json_each(execution."sourceSnapshot") AS cell
         WHERE json_extract(cell.value, '$.kind') = 'validation'
       )
  `;
  const executions = await transaction.$executeRaw`
    DELETE FROM "ResearchExecution"
    WHERE EXISTS (
      SELECT 1
      FROM json_each("ResearchExecution"."sourceSnapshot") AS cell
      WHERE json_extract(cell.value, '$.kind') = 'validation'
    )
  `;
  const cells = await transaction.$executeRaw`
    DELETE FROM "ResearchCell" WHERE "kind" = 'validation'
  `;
  const curatorFindings = await transaction.$executeRaw`
    DELETE FROM "ResearchCuratorFinding"
    WHERE "category" = 'protocol_candidate'
       OR EXISTS (
         SELECT 1
         FROM json_each("ResearchCuratorFinding"."evidence") AS evidence
         WHERE json_extract(evidence.value, '$.sourceType') = 'research_attempt'
       )
  `;
  return { messages, proposals, cellExecutions, executions, cells, curatorFindings };
});

console.log(`[remove-research-validation-protocols] ${JSON.stringify(result)}`);
await prisma.$disconnect();
