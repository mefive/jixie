import { backtestReportStatusWhere } from '#strategy/backtests/state.js';
import { factorReportStatusWhere } from '#factor/evaluations/state.js';
import type { ResearchEmbeddedContextV1, ResearchEmbeddedHostV1 } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ResearchError } from '../errors.js';
import { researchPayloadHash } from '../outputs/fingerprints.js';

import { macroRegimeTemplateResource } from '#factor/definitions/templates/macro-regime.js';

/**
 * 由服务端解析业务身份，宿主实体之后消失也不影响快照读取。
 *
 * Resolve identity on the server; snapshots remain readable if the host later disappears.
 */
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
      const template = macroRegimeTemplateResource(host.id, 'en');
      if (template) {
        ({ name, code } = template);
        language = 'typescript';
        break;
      }
      const factor = await transaction.factor.findFirst({
        where: {
          id: host.id,
          userId: { in: [userId, 'builtin'] },
        },
        select: { name: true, code: true, language: true },
      });
      if (!factor) {
        throw new ResearchError('embedded_not_found');
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
        throw new ResearchError('embedded_not_found');
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
          AND: [factorReportStatusWhere(['done'])],
        },
        select: { id: true, payload: true },
      });
      if (!row?.payload) {
        throw new ResearchError('embedded_invalid_report');
      }
      report = { type: 'factor', id: row.id, contentHash: researchPayloadHash(row.payload) };
    } else {
      const row = await transaction.backtestReport.findFirst({
        where: {
          id: reportId,
          userId,
          strategyId: host.id,
          AND: [backtestReportStatusWhere(['done'])],
        },
        select: { id: true, payload: true },
      });
      if (!row?.payload) {
        throw new ResearchError('embedded_invalid_report');
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
