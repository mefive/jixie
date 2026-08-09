import { prisma } from '../lib/prisma.js';
import type { FactorAnalysisSource } from './analysis-job.js';
import { resolvePanelTemplateSource } from './panel-templates.js';
import { factorPanelCompositeDefinitionV2Schema } from './report-spec.js';

export async function resolvePanelFactorSource(
  userId: string,
  factorId: string,
): Promise<FactorAnalysisSource | null> {
  const single =
    resolvePanelTemplateSource(factorId) ?? (await resolveCustomPanelSource(userId, factorId));
  if (single) {
    return single;
  }

  const composite = await prisma.factorComposite.findFirst({
    where: { id: factorId, userId },
    select: { name: true, definition: true },
  });
  if (!composite) {
    return null;
  }
  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(composite.definition);
  if (!definition.success) {
    return null;
  }
  const components: Extract<FactorAnalysisSource, { kind: 'panel_composite' }>['components'] = [];
  for (const component of definition.data.components) {
    const source =
      resolvePanelTemplateSource(component.factor) ??
      (await resolveCustomPanelSource(userId, component.factor));
    if (!source) {
      return null;
    }
    components.push({
      factor: component.factor,
      code: source.code,
      label: source.label,
      direction: component.direction,
    });
  }
  return {
    kind: 'panel_composite',
    label: composite.name,
    definition: definition.data,
    components,
  };
}

async function resolveCustomPanelSource(
  userId: string,
  factorId: string,
): Promise<Extract<FactorAnalysisSource, { kind: 'panel' }> | null> {
  const custom = await prisma.factor.findFirst({
    where: { id: factorId, userId, analysisKind: 'panel' },
    select: { code: true, name: true },
  });
  return custom ? { kind: 'panel', code: custom.code, label: custom.name } : null;
}
