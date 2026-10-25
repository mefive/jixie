import { getDatabase } from '#infra/database/prisma.js';
import { sha256 } from '../sources/fingerprint.js';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from './builtin-factors.js';
import { TIME_SERIES_TEMPLATES } from './templates/time-series.js';
import { PANEL_TEMPLATES } from './templates/panel.js';

/**
 * 只初始化缺失的内置版本；已有代码、状态和发布关联永不由启动覆盖。
 *
 * Initialize missing builtin versions only; startup never overwrites saved source, status or publication links.
 */
export async function seedBuiltinFactors(): Promise<void> {
  const definitions = [
    ...BUILTIN_FACTORS.map((definition) => ({
      key: definition.key,
      name: definition.label,
      code: definition.code,
      analysisKind: 'cross_sectional',
    })),
    ...TIME_SERIES_TEMPLATES.map((definition) => ({
      key: definition.key,
      name: definition.label.zh,
      code: definition.code,
      analysisKind: 'time_series',
    })),
    ...PANEL_TEMPLATES.map((definition) => ({
      key: definition.key,
      name: definition.label.zh,
      code: definition.code,
      analysisKind: 'panel',
    })),
  ];

  for (const definition of definitions) {
    await getDatabase().factor.upsert({
      where: { id: definition.key },
      update: {},
      create: {
        id: definition.key,
        userId: BUILTIN_USER_ID,
        key: definition.key,
        name: definition.name,
        code: definition.code,
        analysisKind: definition.analysisKind,
        status: 'published',
        codeHash: sha256(definition.code),
        publishedAt: new Date(),
      },
    });
  }
}
