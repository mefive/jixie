import type { UniverseSpecV1 } from '../research.js';
import { RESEARCH_EMBEDDED_LIMITS } from '../research-embedded.js';
import { z } from 'zod';

// Universe queries.
const dateSchema = z.string().regex(/^\d{8}$/, 'must use YYYYMMDD');

const objectIdSchema = z.string().trim().min(1).max(120);

const entityRefSchema = z.strictObject({
  assetType: z.enum(['stock', 'etf', 'index', 'future']),
  id: objectIdSchema,
});

const universeSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('equity_market'), market: z.literal('CN') }),
  z.strictObject({ kind: z.literal('index_members'), indexCode: objectIdSchema }),
  z.strictObject({
    kind: z.literal('explicit'),
    entities: z.array(entityRefSchema).min(1).max(500),
  }),
]);

const universeAsOfSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), date: dateSchema }),
  z.strictObject({ kind: z.literal('latest_available') }),
  z.strictObject({ kind: z.literal('periodic'), frequency: z.literal('month_end') }),
]);

export const universeSpecV1Schema = z.strictObject({
  version: z.literal(1),
  source: universeSourceSchema,
  asOf: universeAsOfSchema,
  predicates: z
    .array(
      z.strictObject({
        measure: z.string().min(1).max(80),
        measureVersion: z.literal(1),
        op: z.enum(['>', '>=', '<', '<=', '==', '!=']),
        value: z.union([z.number().finite(), z.string().min(1).max(120)]),
      }),
    )
    .max(20),
  missing: z.literal('exclude'),
  eligibility: z.strictObject({
    minimumListedDays: z.number().int().min(0).max(36500),
    suspension: z.literal('exclude'),
    riskWarning: z.enum(['include', 'exclude']),
  }),
  sort: z
    .strictObject({
      measure: z.string().min(1).max(80),
      measureVersion: z.literal(1),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  select: z
    .array(z.strictObject({ measure: z.string().min(1).max(80), measureVersion: z.literal(1) }))
    .min(1)
    .max(20),
  limit: z.number().int().positive().max(5000).optional(),
}) satisfies z.ZodType<UniverseSpecV1>;

// Embedded analysis.
const embeddedHostSchema = z.strictObject({
  type: z.enum(['factor', 'strategy']),
  id: z.string().trim().min(1).max(128),
});

export const embeddedDraftSchema = z.strictObject({
  source: z.string().min(1).max(RESEARCH_EMBEDDED_LIMITS.sourceCharacters),
  parameters: z
    .record(z.string().max(100), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .refine(
      (value) =>
        new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        RESEARCH_EMBEDDED_LIMITS.parametersBytes,
    ),
  inputScope: z.string().trim().min(1).max(2_000),
  reportId: z.string().trim().min(1).max(128).optional(),
});

export const embeddedCreateSchema = embeddedDraftSchema.extend({
  host: embeddedHostSchema,
  title: z.string().trim().min(1).max(120),
});

export type ResearchEmbeddedCreateInput = z.output<typeof embeddedCreateSchema>;

export const embeddedUpdateSchema = embeddedDraftSchema.extend({
  expectedRevision: z.number().int().positive(),
});

export type ResearchEmbeddedUpdateInput = z.output<typeof embeddedUpdateSchema>;

export const embeddedDeriveSchema = z.strictObject({
  parentVersionId: z.string().min(1).max(128),
  draft: embeddedDraftSchema.optional(),
});

export type ResearchEmbeddedDeriveInput = z.output<typeof embeddedDeriveSchema>;

export const embeddedRunSchema = z.strictObject({
  requestId: z.string().min(1).max(128),
  expectedRevision: z.number().int().positive(),
});

export type ResearchEmbeddedRunInput = z.output<typeof embeddedRunSchema>;

export const embeddedPageSchema = z.strictObject({
  cursor: z.string().max(128).optional(),
  limit: z.coerce.number<string>().int().min(1).max(50).default(20),
});

export type ResearchEmbeddedPageQuery = z.output<typeof embeddedPageSchema>;

export const embeddedListSchema = embeddedPageSchema.extend({
  hostType: z.enum(['factor', 'strategy']),
  hostId: z.string().min(1).max(128),
});

export type ResearchEmbeddedListQuery = z.output<typeof embeddedListSchema>;

// Embedded data references.
export const embeddedDataReferenceSchema = z.strictObject({
  label: z.string().trim().min(1).max(160),
  method: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()),
});

/** The API supplies the SDK validator without duplicating the wire shape or collection limits. */
export function createEmbeddedDataReferencesSchema(
  referenceSchema: typeof embeddedDataReferenceSchema = embeddedDataReferenceSchema,
) {
  return z
    .array(referenceSchema)
    .max(8)
    .refine(
      (references) => new TextEncoder().encode(JSON.stringify(references)).byteLength <= 16_384,
      'Selected data references exceed 16 KiB',
    )
    .default([]);
}

export const embeddedDataReferencesSchema = createEmbeddedDataReferencesSchema();

// Curator.
export const curatorFindingUpdateSchema = z
  .strictObject({
    disposition: z.enum(['accepted', 'rejected', 'deferred', 'duplicate']).optional(),
    note: z.string().trim().max(500).optional(),
    verificationAssessment: z.enum(['correct', 'incorrect']).optional(),
  })
  .refine((input) => input.disposition || input.verificationAssessment, {
    message: 'disposition or verificationAssessment is required',
  });

export type ResearchCuratorFindingUpdateInput = z.output<typeof curatorFindingUpdateSchema>;

// Documents and cells.
export const documentListQuerySchema = z.strictObject({
  state: z.enum(['active', 'archived']).default('active'),
});

export const createDocumentSchema = z.union([
  z.strictObject({
    template: z.enum(['blank', 'index_relationship', 'equity_fcff_valuation']).default('blank'),
  }),
  z.strictObject({
    source: z.strictObject({
      type: z.literal('backtest-report'),
      reportId: z.string().trim().min(1),
    }),
  }),
]);

export const createCellSchema = z.strictObject({
  kind: z.enum(['markdown', 'python']),
  source: z.string().max(100_000).default(''),
});

export const updateCellSchema = z
  .strictObject({
    source: z.string().max(100_000).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    expectedRevision: z.number().int().positive(),
  })
  .refine((value) => value.source !== undefined || value.config !== undefined);

export type UpdateResearchCellInput = z.output<typeof updateCellSchema>;

export const renameDocumentSchema = z.strictObject({ title: z.string().trim().min(1).max(120) });

// Execution.
export const runDocumentSchema = z.strictObject({ clean: z.boolean().default(true) });

// Evidence.
export const promoteExecutionSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(160),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  userNote: z.string().trim().max(2_000).optional(),
});

// Proposals.
export const cellChangeReviewSchema = z.strictObject({
  expectedContentRevision: z.number().int().positive(),
});

// Agent.
const clarificationSelectionSchema = z.strictObject({
  questionId: z.string().min(1).max(80),
  selectedOptionIds: z.array(z.string().min(1).max(200)).max(4).default([]),
  customText: z.string().trim().min(1).max(500).optional(),
});

export const researchAgentInputSchema = z
  .strictObject({
    conversationId: z.string().min(1).optional(),
    message: z.string().trim().min(1).max(2000).optional(),
    contextCellIds: z.array(z.string().min(1).max(80)).max(8).default([]),
    attemptId: z.string().min(1).max(80).optional(),
    clarificationAnswer: z
      .strictObject({
        clarificationId: z.string().min(1).max(80),
        selections: z.array(clarificationSelectionSchema).min(1).max(3),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.message) === Boolean(value.clarificationAnswer)) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one of message or clarificationAnswer.',
      });
    }
    if (value.clarificationAnswer && (!value.conversationId || value.attemptId)) {
      context.addIssue({
        code: 'custom',
        path: ['clarificationAnswer'],
        message:
          'A clarification answer requires its conversationId and cannot explain an attempt.',
      });
    }
    if (value.clarificationAnswer && value.contextCellIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['contextCellIds'],
        message: 'A clarification answer cannot attach Research Cells.',
      });
    }
    if (value.attemptId && value.contextCellIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['contextCellIds'],
        message: 'A Cell execution explanation cannot attach additional Research Cells.',
      });
    }
  });

export type ResearchAgentTurnInput = z.output<typeof researchAgentInputSchema>;

// Data catalog.
export const dataCatalogQuerySchema = z.strictObject({
  q: z.string().trim().max(120).default(''),
  assetType: z.enum(['stock', 'etf', 'index', 'future']).optional(),
  scope: z
    .enum(['instruments', 'datasets', 'factor_reports', 'backtest_reports'])
    .default('instruments'),
  limit: z.coerce.number<string>().int().min(1).max(50).default(24),
});

// Python language service.
const languagePosition = z.strictObject({
  line: z.number().int().min(0).max(100_000),
  character: z.number().int().min(0).max(100_000),
});

export const pythonLanguageRequestSchema = z
  .strictObject({
    version: z.literal(1),
    documentId: z.string().min(1).max(80),
    cells: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(80),
          source: z.string().max(100_000),
        }),
      )
      .max(100),
    cellId: z.string().min(1).max(80),
    action: z.enum([
      'completion',
      'hover',
      'signature_help',
      'definition',
      'references',
      'prepare_rename',
      'rename',
      'diagnostics',
    ]),
    position: languagePosition.optional(),
    newName: z
      .string()
      .regex(/^[A-Za-z_]\w*$/)
      .max(120)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.cells.reduce((total, cell) => total + cell.source.length, 0) > 500_000) {
      context.addIssue({
        code: 'custom',
        path: ['cells'],
        message: 'Document source is too large',
      });
    }
    if (!value.cells.some((cell) => cell.id === value.cellId)) {
      context.addIssue({
        code: 'custom',
        path: ['cellId'],
        message: 'Cell is not in the document',
      });
    }
    if (value.action !== 'diagnostics' && !value.position) {
      context.addIssue({ code: 'custom', path: ['position'], message: 'Position is required' });
    }
    if (value.action === 'rename' && !value.newName) {
      context.addIssue({ code: 'custom', path: ['newName'], message: 'New name is required' });
    }
  });

// Embedded input mode.
export const embeddedInputModeSchema = z.strictObject({
  inputMode: z.enum(['retained', 'current']),
  expectedRevision: z.number().int().positive(),
});

export type ResearchEmbeddedInputModeInput = z.output<typeof embeddedInputModeSchema>;

// HTTP input types describe values before defaults and transformations.
export type ResearchUniverseRequest = z.input<typeof universeSpecV1Schema>;
export type UpdateResearchEmbeddedRequest = z.input<typeof embeddedUpdateSchema>;
export type DeriveResearchEmbeddedRequest = z.input<typeof embeddedDeriveSchema>;
export type RunResearchEmbeddedRequest = z.input<typeof embeddedRunSchema>;
export type ResearchEmbeddedPageRequestQuery = z.input<typeof embeddedPageSchema>;
export type ResearchEmbeddedListRequestQuery = z.input<typeof embeddedListSchema>;
export type ResearchCuratorFindingRequest = z.input<typeof curatorFindingUpdateSchema>;
export type ResearchDocumentListRequestQuery = z.input<typeof documentListQuerySchema>;
export type CreateResearchDocumentRequest = z.input<typeof createDocumentSchema>;
export type CreateResearchCellRequest = z.input<typeof createCellSchema>;
export type UpdateResearchCellRequest = z.input<typeof updateCellSchema>;
export type RenameResearchDocumentRequest = z.input<typeof renameDocumentSchema>;
export type RunResearchDocumentRequest = z.input<typeof runDocumentSchema>;
export type PromoteResearchExecutionRequest = z.input<typeof promoteExecutionSchema>;
export type ResearchCellChangeReviewRequest = z.input<typeof cellChangeReviewSchema>;
export type ResearchAgentRequest = z.input<typeof researchAgentInputSchema>;
export type ResearchDataCatalogRequestQuery = z.input<typeof dataCatalogQuerySchema>;
export type ResearchLanguageRequest = z.input<typeof pythonLanguageRequestSchema>;
export type ResearchEmbeddedInputModeRequest = z.input<typeof embeddedInputModeSchema>;
