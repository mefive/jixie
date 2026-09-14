import type { Prisma } from '@prisma/client';
import type { FactorQuestionContextV1, Locale } from '@jixie/shared';
import { t } from '#i18n/index.js';
import { timeSeriesTemplateResource } from '../definitions/templates/time-series.js';
import { panelTemplateResource } from '../definitions/templates/panel.js';
import { macroRegimeTemplateResource } from '../definitions/templates/macro-regime.js';
import { BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { sha256 } from '../reports/spec.js';
import { reportSummary } from '../reports/views.js';
import { failFactorOperation } from '../operation-errors.js';

/** Capture only the selected, authorized source. Never resolve a display name or latest report. */
export async function captureFactorQuestionContext(
  database: Prisma.TransactionClient,
  userId: string,
  factorKey: string,
  reportId: string | undefined,
  locale: Locale,
): Promise<FactorQuestionContextV1> {
  const template =
    timeSeriesTemplateResource(factorKey, locale) ??
    panelTemplateResource(factorKey, locale) ??
    macroRegimeTemplateResource(factorKey, locale);
  let factor: FactorQuestionContextV1['factor'];
  if (template) {
    factor = {
      key: factorKey,
      name: template.name,
      kind: 'template',
      analysisKind: template.analysisKind,
      language: 'typescript',
      source: template.code,
      sourceHash: sha256(template.code),
    };
  } else {
    const row = await database.factor.findFirst({
      where: {
        id: factorKey,
        OR: [
          { userId: { in: [userId, BUILTIN_USER_ID] } },
          { visibility: 'public', status: 'published' },
        ],
      },
      select: { name: true, code: true, language: true, analysisKind: true },
    });
    if (row) {
      factor = {
        key: factorKey,
        name: row.name,
        kind: 'factor',
        analysisKind: row.analysisKind,
        language: row.language,
        source: row.code,
        sourceHash: sha256(row.code),
      };
    } else {
      const composite = await database.factorComposite.findFirst({
        where: { id: factorKey, OR: [{ userId }, { visibility: 'public', status: 'published' }] },
        select: { name: true, definition: true },
      });
      if (!composite) {
        return failFactorOperation('missing', t(locale, 'factorNotFound'));
      }
      const source = JSON.stringify(composite.definition);
      factor = {
        key: factorKey,
        name: composite.name,
        kind: 'composite',
        analysisKind:
          (composite.definition as { version?: number }).version === 2
            ? 'panel'
            : 'cross_sectional',
        language: 'json',
        source,
        sourceHash: sha256(source),
      };
    }
  }

  let report: FactorQuestionContextV1['report'] = null;
  if (reportId) {
    const row = await database.factorReport.findFirst({
      where: { id: reportId, userId, factor: factorKey },
    });
    if (
      !row ||
      row.status !== 'done' ||
      !row.payload ||
      (row.phase === 'holdout' && !row.revealedAt)
    ) {
      return failFactorOperation('invalid', t(locale, 'factorQuestionReportUnavailable'));
    }
    report = {
      id: row.id,
      contentHash: sha256(row.payload),
      summary: reportSummary(row),
      factorCodeSnapshot: row.factorCodeSnapshot,
      factorCodeHash: row.factorCodeHash,
      dataRevision: row.dataRevision,
    };
  }
  const context: FactorQuestionContextV1 = {
    version: 1,
    capturedAt: new Date().toISOString(),
    factor,
    report,
  };
  // The summary and source are preserved intact; oversized context is rejected, not silently cut.
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > 64 * 1024) {
    return failFactorOperation('invalid', t(locale, 'factorQuestionContextTooLarge'));
  }
  return context;
}
