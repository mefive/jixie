import { z } from 'zod';
import { prepareResearchCellChangeProposal } from '../../research/workbench-cell-changes.js';
import type { AgentTool } from './types.js';

const cellKindSchema = z.enum(['markdown', 'python', 'validation']);
const operationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create'),
    cellKind: cellKindSchema,
    source: z.string().max(100_000),
    afterCellId: z.string().min(1).max(80).optional(),
  }),
  z.strictObject({
    kind: z.literal('update'),
    cellId: z.string().min(1).max(80),
    expectedRevision: z.number().int().positive(),
    source: z.string().max(100_000),
  }),
  z.strictObject({
    kind: z.literal('delete'),
    cellId: z.string().min(1).max(80),
    expectedRevision: z.number().int().positive(),
  }),
]);
const argsSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1_000),
  operations: z.array(operationSchema).min(1).max(8),
});

/** Create the document-bound proposal artifact for one Research Agent turn. */
export function createProposeResearchCellChangesTool(args: {
  userId: string;
  documentId: string;
  editableCellIds: Set<string>;
}): AgentTool {
  let proposalCreated = false;
  return {
    name: 'proposeResearchCellChanges',
    description:
      'Create one user-reviewed batch of Research Cell changes. Call this only when the user explicitly asks to change the current research document. Use exact Cell ids and revisions from the supplied document context. Preserve unrelated Cells and source. Create accepts markdown, python, or validation source and may insert after one existing Cell. Update must send the complete replacement source and expectedRevision. Delete is allowed only when the user explicitly requests removal. The tool validates Python syntax, Validation JSON, duplicate definitions, dependency cycles, source sizes, and current revisions. The product may auto-apply a non-deleting proposal into an editable review after the turn; deletion remains pending for explicit application. It never executes Cells. After success, tell the user that the changes are ready for review; never claim that code ran or that the user accepted them.',
    parameters: z.toJSONSchema(argsSchema),
    async run(input) {
      if (proposalCreated) {
        throw new Error('Only one Research Cell change proposal is allowed per Agent turn.');
      }
      const parsed = argsSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid Research Cell change proposal: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }
      const unavailableCellIds = parsed.data.operations
        .filter((operation) => operation.kind === 'update')
        .map((operation) => operation.cellId)
        .filter((cellId) => !args.editableCellIds.has(cellId));
      if (unavailableCellIds.length > 0) {
        throw new Error(
          `Complete source was not included for Cells ${unavailableCellIds.join(', ')}; do not propose replacing truncated source.`,
        );
      }
      const proposal = await prepareResearchCellChangeProposal(
        args.userId,
        args.documentId,
        parsed.data,
      );
      proposalCreated = true;
      return {
        observation: JSON.stringify({
          proposalId: proposal.id,
          status: proposal.status,
          operations: proposal.operations.map((operation) => ({
            kind: operation.kind,
            cellId: operation.cellId,
            cellKind: operation.cellKind,
            position: operation.position,
            addedLines: operation.addedLines,
            removedLines: operation.removedLines,
          })),
          userActionRequired: true,
          reviewEligible: !proposal.operations.some((operation) => operation.kind === 'delete'),
          applied: false,
          executed: false,
        }),
        rows: proposal.operations.length,
        researchCellChange: proposal,
      };
    },
  };
}
