import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock('../../research/concept-binding-resolver.js', () => ({
  resolveResearchConceptBindings: mocks.resolve,
}));

import { researchConceptBindings } from '../../research/concept-bindings.js';
import { createRequestResearchClarificationTool } from './request-research-clarification.js';

function catalogEvidence(bindingIds: string[]) {
  return {
    sdkReadyBindingIds: new Set(bindingIds),
    sdkMethodNames: new Set<string>(),
    pythonRuntimeInspected: false,
  };
}

describe('requestResearchClarification tool', () => {
  beforeEach(() => {
    mocks.resolve.mockReset();
  });

  it('creates bilingual choices only from canonical concepts and available audited bindings', async () => {
    const binding = researchConceptBindings('commodity.gold.price')[0]!;
    mocks.resolve.mockResolvedValue([
      { binding, available: true, match: { source: binding.source }, unavailableReason: null },
    ]);
    const tool = createRequestResearchClarificationTool({
      documentId: 'document-1',
      catalogEvidence: catalogEvidence([binding.id]),
    });

    const result = await tool.run({
      title: '确认黄金序列',
      questions: [
        {
          prompt: '本次研究使用哪个黄金价格代理？',
          options: [{ kind: 'binding', bindingId: binding.id }, { kind: 'keep_gap' }],
        },
      ],
    });

    expect(result.researchClarification).toMatchObject({
      documentId: 'document-1',
      status: 'pending',
      questions: [
        {
          prompt: '本次研究使用哪个黄金价格代理？',
          selectionMode: 'single',
          allowCustom: true,
          options: [
            {
              id: `binding:${binding.id}`,
              kind: 'binding',
              referenceId: binding.id,
              labelZh: binding.nameZh,
            },
            { id: 'keep_gap', kind: 'keep_gap', labelEn: 'Do not substitute' },
          ],
        },
      ],
    });
    expect(JSON.parse(result.observation)).toMatchObject({
      userActionRequired: true,
      proposedCellChanges: false,
    });
  });

  it('rejects registered bindings without executable local data', async () => {
    const binding = researchConceptBindings('commodity.gold.price')[0]!;
    mocks.resolve.mockResolvedValue([
      {
        binding,
        available: false,
        match: null,
        unavailableReason: 'binding_registered_no_local_data',
      },
    ]);
    const tool = createRequestResearchClarificationTool({
      documentId: 'document-1',
      catalogEvidence: catalogEvidence([binding.id]),
    });

    await expect(
      tool.run({
        title: '确认黄金序列',
        questions: [
          {
            prompt: '请选择',
            options: [{ kind: 'binding', bindingId: binding.id }, { kind: 'keep_gap' }],
          },
        ],
      }),
    ).rejects.toThrow('not executable through the public Research SDK');
  });

  it('rejects locally available bindings that the public Research SDK cannot load', async () => {
    const binding = researchConceptBindings('macro.inflation.us.cpi.headline')[0]!;
    mocks.resolve.mockResolvedValue([
      { binding, available: true, match: { source: binding.source }, unavailableReason: null },
    ]);
    const tool = createRequestResearchClarificationTool({
      documentId: 'document-1',
      catalogEvidence: catalogEvidence([binding.id]),
    });

    await expect(
      tool.run({
        title: '确认通胀序列',
        questions: [
          {
            prompt: '请选择',
            options: [{ kind: 'binding', bindingId: binding.id }, { kind: 'keep_gap' }],
          },
        ],
      }),
    ).rejects.toThrow('not executable through the public Research SDK');
  });

  it('rejects a binding that was not returned by the current turn catalog query', async () => {
    const binding = researchConceptBindings('commodity.gold.price')[0]!;
    const tool = createRequestResearchClarificationTool({
      documentId: 'document-1',
      catalogEvidence: catalogEvidence([]),
    });

    await expect(
      tool.run({
        title: '确认黄金序列',
        questions: [
          {
            prompt: '请选择',
            options: [{ kind: 'binding', bindingId: binding.id }, { kind: 'keep_gap' }],
          },
        ],
      }),
    ).rejects.toThrow('was not returned as SDK-ready');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
