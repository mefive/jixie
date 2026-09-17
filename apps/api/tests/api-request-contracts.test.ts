import { describe, expect, it } from 'vitest';
import { emailLoginRequestSchema } from '#auth/schema.js';
import { embeddedDataReferencesSchema } from '#research/schema.js';
import { factorAgentBodySchema, factorQuestionSchema } from '#factor/schema.js';
import { strategyAgentBodySchema } from '#strategy/schema.js';
import {
  createFactorDraftSchema,
  factorCorrelationQuerySchema,
  factorReportListQuerySchema,
} from '@jixie/shared/api/factor';
import {
  embeddedDraftSchema,
  embeddedDataReferencesSchema as referenceWireSchema,
  promoteExecutionSchema,
  updateCellSchema,
} from '@jixie/shared/api/research';
import { createStrategySchema } from '@jixie/shared/api/strategy';

describe('shared HTTP request contracts', () => {
  it('keeps strategy naming optional and strips unrelated request fields', () => {
    const request = {
      code: 'export default {}',
      start: '20240101',
      end: '20241231',
      initialCash: 100_000,
      prompt: '  A research strategy  ',
      userId: 'untrusted',
    };
    const parsed = createStrategySchema.parse(request);
    expect(parsed).toEqual({
      code: request.code,
      start: request.start,
      end: request.end,
      initialCash: request.initialCash,
      prompt: 'A research strategy',
    });
    expect(createStrategySchema.safeParse({ ...request, initialCash: -1 }).success).toBe(false);
  });

  it('applies server defaults and converts query strings only at the input boundary', () => {
    expect(
      createFactorDraftSchema.parse({ key: 'momentum', name: 'Momentum', code: 'code' }),
    ).toMatchObject({ language: 'typescript', analysisKind: 'cross_sectional' });
    expect(factorCorrelationQuerySchema.parse({ keys: 'size,value' })).toEqual({
      keys: ['size', 'value'],
      freq: 'month',
      start: '20150101',
      end: '20261231',
    });
    expect(factorReportListQuerySchema.parse({ factor: 'size', limit: '7' }).limit).toBe(7);
    expect(factorReportListQuerySchema.safeParse({ factor: 'size', limit: '101' }).success).toBe(
      false,
    );
    expect(promoteExecutionSchema.parse({ displayName: '  Experiment  ' })).toEqual({
      displayName: 'Experiment',
      tags: [],
    });
  });

  it('keeps strict-object and revision checks on Research edits', () => {
    expect(updateCellSchema.safeParse({ source: 'code' }).success).toBe(false);
    expect(updateCellSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(
      updateCellSchema.safeParse({ source: 'code', expectedRevision: 1, extra: true }).success,
    ).toBe(false);
    expect(updateCellSchema.parse({ source: '', expectedRevision: 1 })).toEqual({
      source: '',
      expectedRevision: 1,
    });
  });

  it('preserves server-only invite-code normalization after shared email validation', () => {
    expect(
      emailLoginRequestSchema.parse({ email: '  USER@Example.com ', inviteCode: ' il-ou ' }),
    ).toEqual({ email: 'user@example.com', inviteCode: '110V' });
    expect(
      emailLoginRequestSchema.safeParse({ email: 'user@example.com', inviteCode: '   ' }).success,
    ).toBe(false);
  });

  it('enforces UTF-8 byte limits with the browser-compatible shared schemas', () => {
    const draft = {
      source: 'print(1)',
      inputScope: 'Research',
      parameters: { text: '中'.repeat(6_000) },
    };
    expect(Buffer.byteLength(JSON.stringify(draft.parameters))).toBeGreaterThan(16_384);
    expect(embeddedDraftSchema.safeParse(draft).success).toBe(false);
    const references = [
      {
        label: 'Report',
        method: 'research_factor_report',
        arguments: { report_id: '中'.repeat(6_000) },
      },
    ];
    expect(referenceWireSchema.safeParse(references).success).toBe(false);
    expect(referenceWireSchema.parse(undefined)).toEqual([]);
  });

  it('retains SDK validation when the API composes shared Agent request schemas', () => {
    const dataReferences = [{ label: 'Report', method: 'invented_method', arguments: {} }];
    expect(referenceWireSchema.safeParse(dataReferences).success).toBe(true);
    expect(embeddedDataReferencesSchema.safeParse(dataReferences).success).toBe(false);
    for (const schema of [strategyAgentBodySchema, factorAgentBodySchema]) {
      expect(schema.safeParse({ code: 'code', message: 'Explain', dataReferences }).success).toBe(
        false,
      );
      expect(schema.parse({ code: 'code', message: ' Explain ' }).dataReferences).toEqual([]);
    }
    expect(
      factorQuestionSchema.safeParse({ factorKey: 'size', message: 'Explain', dataReferences })
        .success,
    ).toBe(false);
  });
});
