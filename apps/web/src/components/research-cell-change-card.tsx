import { lazy, Suspense, useMemo, useState } from 'react';
import { Button, Modal, Tooltip } from 'antd';
import classNames from 'classnames';
import type {
  ResearchCellChangeAttemptV1,
  ResearchCellChangeOperationV1,
  ResearchCellChangeProposalV1,
} from '@jixie/shared';
import {
  faCheck,
  faCircleExclamation,
  faCodeCompare,
  faCommentDots,
  faFileCirclePlus,
  faPen,
  faPlay,
  faRotate,
  faTrash,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useTranslation } from 'react-i18next';
import './research-cell-change-card.css';

const ResearchCellChangeDiff = lazy(() => import('./research-cell-change-diff'));

interface ResearchCellChangeCardProps {
  proposal: ResearchCellChangeProposalV1;
  busy?: boolean;
  runBusy?: boolean;
  explanationBusyId?: string | null;
  attempts?: ResearchCellChangeAttemptV1[];
  documentContentRevision?: number;
  onApply?: (proposalId: string) => Promise<void>;
  onReject?: (proposalId: string) => Promise<void>;
  onRun?: (proposalId: string) => Promise<void>;
  onExplain?: (attempt: ResearchCellChangeAttemptV1) => Promise<void>;
}

/** Compact, review-first rendering of an Agent-authored Cell change proposal. */
export default function ResearchCellChangeCard({
  proposal,
  busy = false,
  runBusy = false,
  explanationBusyId,
  attempts = [],
  documentContentRevision,
  onApply,
  onReject,
  onRun,
  onExplain,
}: ResearchCellChangeCardProps) {
  const { t } = useTranslation('research');
  const [diffOpen, setDiffOpen] = useState(false);
  const [selectedOperationId, setSelectedOperationId] = useState(
    proposal.operations[0]?.operationId ?? '',
  );
  const selectedOperation = useMemo(
    () =>
      proposal.operations.find((operation) => operation.operationId === selectedOperationId) ??
      proposal.operations[0],
    [proposal.operations, selectedOperationId],
  );
  const pending = proposal.status === 'pending';
  const latestAttempt = attempts[0];
  const executable = proposal.operations.some(
    (operation) =>
      (operation.kind !== 'delete' &&
        (operation.cellKind === 'python' || operation.cellKind === 'validation')) ||
      (operation.kind === 'delete' && operation.cellKind === 'python'),
  );
  const documentChanged =
    proposal.status === 'applied' &&
    proposal.appliedDocumentContentRevision !== documentContentRevision;
  const totals = proposal.operations.reduce(
    (sum, operation) => ({
      added: sum.added + operation.addedLines,
      removed: sum.removed + operation.removedLines,
    }),
    { added: 0, removed: 0 },
  );

  return (
    <section
      className={classNames('jx-researchCellChange', `jx-researchCellChange--${proposal.status}`)}
      data-testid={`research-cell-change-${proposal.id}`}
    >
      <header className="jx-researchCellChange-head">
        <span className="jx-researchCellChange-icon" aria-hidden="true">
          <FontAwesomeIcon icon={statusIcon(proposal.status)} />
        </span>
        <span className="jx-researchCellChange-title">{proposal.title}</span>
        <span
          className={`jx-researchCellChange-status jx-researchCellChange-status--${proposal.status}`}
        >
          {t(`workbench.cellChange.status.${proposal.status}`)}
        </span>
      </header>

      {proposal.summary && <p className="jx-researchCellChange-summary">{proposal.summary}</p>}

      <div className="jx-researchCellChange-operations">
        {proposal.operations.map((operation) => (
          <button
            type="button"
            key={operation.operationId}
            className={classNames('jx-researchCellChange-operation', {
              'jx-researchCellChange-operation--active':
                operation.operationId === selectedOperation?.operationId,
            })}
            onClick={() => {
              setSelectedOperationId(operation.operationId);
              setDiffOpen(true);
            }}
          >
            <FontAwesomeIcon icon={operationIcon(operation.kind)} />
            <span className="jx-researchCellChange-operationName">
              {t(`workbench.cellChange.operation.${operation.kind}`, {
                ordinal: operation.position + 1,
                kind: t(`workbench.cellKind.${operation.cellKind}`),
              })}
            </span>
            <LineChanges operation={operation} />
          </button>
        ))}
      </div>

      {latestAttempt && (
        <CellChangeAttemptSummary attempt={latestAttempt} count={attempts.length} />
      )}

      {proposal.conflict && (
        <div className="jx-researchCellChange-conflict" role="status">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{t(`workbench.cellChange.conflict.${proposal.conflict.reason}`)}</span>
        </div>
      )}

      <footer className="jx-researchCellChange-footer">
        <div className="jx-researchCellChange-total" aria-label={t('workbench.cellChange.total')}>
          <span className="jx-researchCellChange-added">+{totals.added}</span>
          <span className="jx-researchCellChange-removed">−{totals.removed}</span>
        </div>
        <div className="jx-researchCellChange-actions">
          <Tooltip title={t('workbench.cellChange.viewDiff')}>
            <Button
              className="jx-researchCellChange-actionButton"
              size="small"
              icon={<FontAwesomeIcon icon={faCodeCompare} />}
              aria-label={t('workbench.cellChange.viewDiff')}
              onClick={() => setDiffOpen(true)}
            />
          </Tooltip>
          {latestAttempt && onExplain && latestAttempt.status !== 'running' && (
            <Tooltip title={t('workbench.cellChange.explainAttempt')}>
              <Button
                className="jx-researchCellChange-actionButton"
                size="small"
                loading={explanationBusyId === latestAttempt.id}
                disabled={runBusy || busy}
                data-testid="research-cell-change-explain"
                icon={<FontAwesomeIcon icon={faCommentDots} />}
                aria-label={t('workbench.cellChange.explainAttempt')}
                onClick={() => void onExplain(latestAttempt)}
              />
            </Tooltip>
          )}
          {proposal.status === 'applied' && executable && onRun && (
            <Tooltip
              title={
                documentChanged
                  ? t('workbench.cellChange.runDocumentChanged')
                  : latestAttempt
                    ? t('workbench.cellChange.rerunAffected')
                    : t('workbench.cellChange.runAffected')
              }
            >
              <Button
                className="jx-researchCellChange-actionButton jx-researchCellChange-actionButton--run"
                size="small"
                loading={runBusy}
                disabled={busy || documentChanged}
                data-testid="research-cell-change-run"
                icon={<FontAwesomeIcon icon={latestAttempt ? faRotate : faPlay} />}
                aria-label={
                  latestAttempt
                    ? t('workbench.cellChange.rerunAffected')
                    : t('workbench.cellChange.runAffected')
                }
                onClick={() => void onRun(proposal.id)}
              />
            </Tooltip>
          )}
          {pending && onReject && (
            <Tooltip title={t('workbench.cellChange.reject')}>
              <Button
                className="jx-researchCellChange-actionButton jx-researchCellChange-actionButton--reject"
                size="small"
                danger
                disabled={busy}
                icon={<FontAwesomeIcon icon={faXmark} />}
                aria-label={t('workbench.cellChange.reject')}
                onClick={() => void onReject(proposal.id)}
              />
            </Tooltip>
          )}
          {pending && onApply && (
            <Tooltip title={t('workbench.cellChange.apply')}>
              <Button
                className="jx-researchCellChange-actionButton jx-researchCellChange-actionButton--apply"
                size="small"
                loading={busy}
                icon={<FontAwesomeIcon icon={faCheck} />}
                aria-label={t('workbench.cellChange.apply')}
                onClick={() => void onApply(proposal.id)}
              />
            </Tooltip>
          )}
        </div>
      </footer>

      <Modal
        rootClassName="jx-researchCellChange-modalRoot"
        title={t('workbench.cellChange.diffTitle', { title: proposal.title })}
        open={diffOpen}
        centered
        width="min(1360px, calc(100vw - 64px))"
        footer={null}
        destroyOnHidden
        closeIcon={<FontAwesomeIcon icon={faXmark} />}
        classNames={{
          mask: 'jx-researchCellChange-modalMask',
          container: 'jx-researchCellChange-modalContainer',
          header: 'jx-researchCellChange-modalHeader',
          body: 'jx-researchCellChange-modalBody',
          title: 'jx-researchCellChange-modalTitle',
          close: 'jx-researchCellChange-modalClose',
        }}
        onCancel={() => setDiffOpen(false)}
      >
        <div className="jx-researchCellChange-diffLayout">
          <nav
            className="jx-researchCellChange-diffNav"
            aria-label={t('workbench.cellChange.cells')}
          >
            {proposal.operations.map((operation) => (
              <button
                type="button"
                key={operation.operationId}
                className={classNames('jx-researchCellChange-diffNavItem', {
                  'jx-researchCellChange-diffNavItem--active':
                    operation.operationId === selectedOperation?.operationId,
                })}
                onClick={() => setSelectedOperationId(operation.operationId)}
              >
                <span>
                  {t(`workbench.cellChange.operation.${operation.kind}`, {
                    ordinal: operation.position + 1,
                    kind: t(`workbench.cellKind.${operation.cellKind}`),
                  })}
                </span>
                <LineChanges operation={operation} />
              </button>
            ))}
          </nav>
          <div className="jx-researchCellChange-diffEditor">
            {selectedOperation && (
              <Suspense fallback={<div className="jx-researchCellChange-diffLoading" />}>
                <ResearchCellChangeDiff proposalId={proposal.id} operation={selectedOperation} />
              </Suspense>
            )}
          </div>
        </div>
      </Modal>
    </section>
  );
}

function LineChanges({ operation }: { operation: ResearchCellChangeOperationV1 }) {
  return (
    <span className="jx-researchCellChange-counts" aria-hidden="true">
      <span className="jx-researchCellChange-added">+{operation.addedLines}</span>
      <span className="jx-researchCellChange-removed">−{operation.removedLines}</span>
    </span>
  );
}

function CellChangeAttemptSummary({
  attempt,
  count,
}: {
  attempt: ResearchCellChangeAttemptV1;
  count: number;
}) {
  const { t } = useTranslation('research');
  const comparison = attempt.comparisonToPrevious;
  return (
    <div
      className={`jx-researchCellChange-attempt jx-researchCellChange-attempt--${attempt.status}`}
      data-testid="research-cell-change-attempt"
    >
      <div className="jx-researchCellChange-attemptHead">
        <span>
          <FontAwesomeIcon icon={attemptStatusIcon(attempt.status)} />
          {t('workbench.cellChange.attemptNumber', { count })}
        </span>
        <span>{t(`workbench.cellChange.attemptStatus.${attempt.status}`)}</span>
      </div>
      <div className="jx-researchCellChange-attemptMeta">
        <span>{t(`workbench.cellChange.attemptScope.${attempt.scope}`)}</span>
        <span>
          {t('workbench.cellChange.executedCells', {
            executed: attempt.cells.length,
            planned: attempt.plannedCellIds.length,
          })}
        </span>
      </div>
      {comparison && (
        <div className="jx-researchCellChange-comparison">
          <span>
            {t('workbench.cellChange.codeChanges', {
              count: comparison.sourceChangedCellIds.length,
            })}
          </span>
          <span>
            {t('workbench.cellChange.outputChanges', {
              count: comparison.outputChangedCellIds.length,
            })}
          </span>
          <span>
            {comparison.environmentChanged
              ? t('workbench.cellChange.environmentChanged')
              : t('workbench.cellChange.environmentUnchanged')}
          </span>
        </div>
      )}
      {attempt.error && (
        <div className="jx-researchCellChange-attemptError">
          {attempt.error === 'upstream_cell_failed'
            ? t('workbench.cellChange.upstreamCellFailed')
            : attempt.error === 'document_changed_during_run'
              ? t('workbench.cellChange.documentChangedDuringRun')
              : attempt.error}
        </div>
      )}
    </div>
  );
}

function operationIcon(kind: ResearchCellChangeOperationV1['kind']) {
  switch (kind) {
    case 'create':
      return faFileCirclePlus;
    case 'update':
      return faPen;
    case 'delete':
      return faTrash;
  }
}

function statusIcon(status: ResearchCellChangeProposalV1['status']) {
  switch (status) {
    case 'pending':
      return faCodeCompare;
    case 'applied':
      return faCheck;
    case 'rejected':
      return faXmark;
    case 'conflicted':
      return faTriangleExclamation;
  }
}

function attemptStatusIcon(status: ResearchCellChangeAttemptV1['status']) {
  switch (status) {
    case 'success':
      return faCheck;
    case 'running':
      return faPlay;
    case 'error':
      return faCircleExclamation;
    case 'cancelled':
      return faXmark;
  }
}
