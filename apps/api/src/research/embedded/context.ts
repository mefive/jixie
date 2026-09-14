import type { Prisma } from '@prisma/client';
import type { ResearchEmbeddedContextV1, ResearchEmbeddedHostV1 } from '@jixie/shared';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import { ResearchEmbeddedError } from './errors.js';
import { timeSeriesTemplateResource } from '#factor/definitions/templates/time-series.js';
import { panelTemplateResource } from '#factor/definitions/templates/panel.js';
import { macroRegimeTemplateResource } from '#factor/definitions/templates/macro-regime.js';

/** Resolve identity on the server; snapshots remain readable if the host later disappears. */
export async function captureEmbeddedContext(
  transaction: Prisma.TransactionClient,
  userId: string,
  host: ResearchEmbeddedHostV1,
  reportId?: string,
): Promise<ResearchEmbeddedContextV1> {
  let name: string;
  let code: string;
  let language: string;
  switch (host.type) {
    case 'factor': {
      const template =
        timeSeriesTemplateResource(host.id, 'en') ??
        panelTemplateResource(host.id, 'en') ??
        macroRegimeTemplateResource(host.id, 'en');
      if (template) {
        ({ name, code } = template);
        language = 'typescript';
        break;
      }
      const factor = await transaction.factor.findFirst({
        where: {
          id: host.id,
          OR: [
            { userId: { in: [userId, 'builtin'] } },
            { visibility: 'public', status: 'published' },
          ],
        },
        select: { name: true, code: true, language: true },
      });
      if (!factor) {
        const composite = await transaction.factorComposite.findFirst({
          where: { id: host.id, OR: [{ userId }, { visibility: 'public', status: 'published' }] },
          select: { name: true, definition: true },
        });
        if (!composite) {
          throw new ResearchEmbeddedError('not_found');
        }
        name = composite.name;
        code = JSON.stringify(composite.definition);
        language = 'json';
        break;
      }
      ({ name, code, language } = factor);
      break;
    }
    case 'strategy': {
      const strategy = await transaction.strategy.findFirst({
        where: { id: host.id, userId },
        select: { name: true, config: true },
      });
      if (!strategy) {
        throw new ResearchEmbeddedError('not_found');
      }
      const config = strategy.config as Record<string, Prisma.JsonValue>;
      name = strategy.name;
      code = typeof config.code === 'string' ? config.code : '';
      language = typeof config.language === 'string' ? config.language : 'typescript';
      break;
    }
  }
  let report: ResearchEmbeddedContextV1['report'];
  if (reportId) {
    if (host.type === 'factor') {
      const row = await transaction.factorReport.findFirst({
        where: {
          id: reportId,
          userId,
          factor: host.id,
          status: 'done',
          OR: [{ phase: { not: 'holdout' } }, { revealedAt: { not: null } }],
        },
        select: { id: true, payload: true },
      });
      if (!row?.payload) {
        throw new ResearchEmbeddedError('invalid_report');
      }
      report = { type: 'factor', id: row.id, contentHash: researchPayloadHash(row.payload) };
    } else {
      const row = await transaction.backtestReport.findFirst({
        where: { id: reportId, userId, strategyId: host.id, status: 'done' },
        select: { id: true, payload: true },
      });
      if (!row?.payload) {
        throw new ResearchEmbeddedError('invalid_report');
      }
      report = { type: 'backtest', id: row.id, contentHash: researchPayloadHash(row.payload) };
    }
  }
  return {
    host,
    name,
    code,
    codeHash: researchPayloadHash({ language, code }),
    language,
    capturedAt: new Date().toISOString(),
    ...(report ? { report } : {}),
  };
}
