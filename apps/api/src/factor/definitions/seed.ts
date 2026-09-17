import { prisma } from '#infra/database/prisma.js';
import { sha256 } from '../sources/fingerprint.js';
import { BUILTIN_FACTORS, BUILTIN_USER_ID } from './builtin-factors.js';
import { TIME_SERIES_TEMPLATES } from './templates/time-series.js';
import { PANEL_TEMPLATES } from './templates/panel.js';

/**
 * Idempotent seed: materialize every preset into its read-only Factor row (called on server boot).
 * A code change updates only the current preset row. Historical reports retain the exact source used
 * for their run.
 */
export async function seedBuiltinFactors(): Promise<void> {
  for (const def of BUILTIN_FACTORS) {
    const existing = await prisma.factor.findUnique({
      where: { id: def.key },
      select: { key: true, code: true, name: true, status: true, codeHash: true },
    });

    if (!existing) {
      await prisma.factor.create({
        data: {
          id: def.key,
          userId: BUILTIN_USER_ID,
          key: def.key,
          name: def.label,
          code: def.code,
          status: 'published',
          codeHash: sha256(def.code),
          publishedAt: new Date(),
        },
      });
      continue;
    }
    if (
      existing.key !== def.key ||
      existing.code !== def.code ||
      existing.name !== def.label ||
      existing.status !== 'published' ||
      existing.codeHash !== sha256(def.code)
    ) {
      await prisma.factor.update({
        where: { id: def.key },
        data: {
          key: def.key,
          name: def.label,
          code: def.code,
          status: 'published',
          codeHash: sha256(def.code),
          publishedAt: new Date(),
          archivedAt: null,
        },
      });
    }
  }
  for (const template of TIME_SERIES_TEMPLATES) {
    const existing = await prisma.factor.findUnique({
      where: { id: template.key },
      select: {
        key: true,
        code: true,
        name: true,
        status: true,
        codeHash: true,
        analysisKind: true,
      },
    });
    const name = template.label.zh;
    const codeHash = sha256(template.code);
    if (!existing) {
      await prisma.factor.create({
        data: {
          id: template.key,
          userId: BUILTIN_USER_ID,
          key: template.key,
          name,
          code: template.code,
          analysisKind: 'time_series',
          status: 'published',
          codeHash,
          publishedAt: new Date(),
        },
      });
      continue;
    }
    if (
      existing.key !== template.key ||
      existing.code !== template.code ||
      existing.name !== name ||
      existing.status !== 'published' ||
      existing.codeHash !== codeHash ||
      existing.analysisKind !== 'time_series'
    ) {
      await prisma.factor.update({
        where: { id: template.key },
        data: {
          key: template.key,
          name,
          code: template.code,
          analysisKind: 'time_series',
          status: 'published',
          codeHash,
          publishedAt: new Date(),
          archivedAt: null,
        },
      });
    }
  }
  for (const template of PANEL_TEMPLATES) {
    const existing = await prisma.factor.findUnique({
      where: { id: template.key },
      select: {
        key: true,
        code: true,
        name: true,
        status: true,
        codeHash: true,
        analysisKind: true,
      },
    });
    const name = template.label.zh;
    const codeHash = sha256(template.code);
    if (!existing) {
      await prisma.factor.create({
        data: {
          id: template.key,
          userId: BUILTIN_USER_ID,
          key: template.key,
          name,
          code: template.code,
          analysisKind: 'panel',
          status: 'published',
          codeHash,
          publishedAt: new Date(),
        },
      });
      continue;
    }
    if (
      existing.key !== template.key ||
      existing.code !== template.code ||
      existing.name !== name ||
      existing.status !== 'published' ||
      existing.codeHash !== codeHash ||
      existing.analysisKind !== 'panel'
    ) {
      await prisma.factor.update({
        where: { id: template.key },
        data: {
          key: template.key,
          name,
          code: template.code,
          analysisKind: 'panel',
          status: 'published',
          codeHash,
          publishedAt: new Date(),
          archivedAt: null,
        },
      });
    }
  }
}
