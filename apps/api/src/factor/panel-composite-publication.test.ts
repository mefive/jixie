import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactorPanelCompositeDefinitionV2 } from '@jixie/shared';
import { factorAnalysisSourceSnapshot } from './analysis-job.js';
import { sha256 } from './report-spec.js';

const mocks = vi.hoisted(() => ({
  compositeFindFirst: vi.fn(),
  compositeUpdateMany: vi.fn(),
  reportFindFirst: vi.fn(),
  factorFindMany: vi.fn(),
  resolveSource: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    factorComposite: {
      findFirst: mocks.compositeFindFirst,
      updateMany: mocks.compositeUpdateMany,
    },
    factorReport: { findFirst: mocks.reportFindFirst },
    factor: { findMany: mocks.factorFindMany },
  },
}));

vi.mock('./panel-composite-source.js', () => ({
  resolvePanelFactorSource: mocks.resolveSource,
}));

import { FactorPublicationError } from './publication.js';
import { publishPanelComposite } from './panel-composite-publication.js';

const DEFINITION: FactorPanelCompositeDefinitionV2 = {
  version: 2,
  key: 'momentum_low_vol_panel',
  name: 'Momentum and low volatility',
  analysisKind: 'panel',
  standardization: 'rank',
  weighting: 'equal',
  components: [
    { factor: 'momentum-1', direction: 'positive' },
    { factor: 'volatility-1', direction: 'negative' },
  ],
};
const SOURCE = {
  kind: 'panel_composite' as const,
  label: DEFINITION.name,
  definition: DEFINITION,
  components: [
    {
      factor: 'momentum-1',
      code: 'export default defineFactorV2({ name: "momentum" });',
      label: 'Momentum',
      direction: 'positive' as const,
    },
    {
      factor: 'volatility-1',
      code: 'export default defineFactorV2({ name: "volatility" });',
      label: 'Volatility',
      direction: 'negative' as const,
    },
  ],
};
const SNAPSHOT = factorAnalysisSourceSnapshot(SOURCE);

describe('immutable panel composite publication', () => {
  beforeEach(() => {
    mocks.compositeFindFirst.mockReset().mockResolvedValue({
      id: 'composite-1',
      key: DEFINITION.key,
      name: DEFINITION.name,
      definition: DEFINITION,
      status: 'draft',
    });
    mocks.reportFindFirst.mockReset().mockResolvedValue({
      id: 'report-1',
      analysisKind: 'panel',
      phase: 'explore',
      revealedAt: null,
      factorCodeSnapshot: SNAPSHOT,
      factorCodeHash: sha256(SNAPSHOT),
    });
    mocks.factorFindMany
      .mockReset()
      .mockResolvedValue([{ id: 'momentum-1' }, { id: 'volatility-1' }]);
    mocks.resolveSource.mockReset().mockResolvedValue(SOURCE);
    mocks.compositeUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it('locks the exact composite definition and component code bundle', async () => {
    const published = await publishPanelComposite('user-1', 'composite-1', 'report-1');

    expect(mocks.factorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['momentum-1', 'volatility-1'] },
          status: 'published',
          analysisKind: 'panel',
        }),
      }),
    );
    expect(mocks.compositeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'composite-1', userId: 'user-1', status: 'draft' },
      data: expect.objectContaining({
        status: 'published',
        approvedReportId: 'report-1',
        codeHash: sha256(SNAPSHOT),
      }),
    });
    expect(published).toMatchObject({
      id: 'composite-1',
      key: DEFINITION.key,
      analysisKind: 'panel',
      status: 'published',
      approvedReportId: 'report-1',
    });
  });

  it('rejects a report after any component code changes', async () => {
    mocks.resolveSource.mockResolvedValue({
      ...SOURCE,
      components: [
        { ...SOURCE.components[0], code: `${SOURCE.components[0].code}\n` },
        SOURCE.components[1],
      ],
    });

    await expect(publishPanelComposite('user-1', 'composite-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_outdated'),
    );
  });

  it('rejects a composite whose component is still a draft', async () => {
    mocks.factorFindMany.mockResolvedValue([{ id: 'momentum-1' }]);

    await expect(publishPanelComposite('user-1', 'composite-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
  });

  it('rejects a sealed holdout report', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-1',
      analysisKind: 'panel',
      phase: 'holdout',
      revealedAt: null,
      factorCodeSnapshot: SNAPSHOT,
      factorCodeHash: sha256(SNAPSHOT),
    });

    await expect(publishPanelComposite('user-1', 'composite-1', 'report-1')).rejects.toEqual(
      new FactorPublicationError('report_invalid'),
    );
  });
});
