import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Modal, Skeleton, Tag, Tooltip } from 'antd';
import type {
  ResearchExecutionCellV1,
  ResearchExecutionStatusV1,
  ResearchExecutionSummaryV1,
  ResearchExecutionV1,
} from '@jixie/shared';
import {
  faArrowLeft,
  faBookmark,
  faCheck,
  faCircleExclamation,
  faClock,
  faCode,
  faFileLines,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useTranslation } from 'react-i18next';
import { LoadingArea } from '@src/components/loading-area';
import { Markdown } from '@src/components/markdown';
import { complex } from './complex';
import { ResearchOutputs } from './research-outputs';
import './research-execution-drawer.css';

interface ResearchExecutionDrawerProps {
  open: boolean;
  onClose: () => void;
}

const ResearchReadOnlyCodeEditor = lazy(() =>
  import('./research-code-editor').then((module) => ({
    default: module.ResearchReadOnlyCodeEditor,
  })),
);

export const ResearchExecutionDrawer = complex.component(
  ({ open, onClose }: ResearchExecutionDrawerProps) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
    const [promotionTarget, setPromotionTarget] = useState<ResearchExecutionSummaryV1 | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [tags, setTags] = useState('');
    const [userNote, setUserNote] = useState('');
    const executions = store.executionListLoader.result ?? [];
    const selectedExecution =
      store.executionLoader.result?.id === selectedExecutionId
        ? store.executionLoader.result
        : null;

    useEffect(() => {
      if (!open) {
        setSelectedExecutionId(null);
        return;
      }
      void store.loadExecutionHistory().catch(() => {});
    }, [open, store]);

    const openExecution = (executionId: string) => {
      setSelectedExecutionId(executionId);
      void store.viewResearchExecution(executionId).catch(() => {});
    };
    const openPromotion = (execution: ResearchExecutionSummaryV1) => {
      setPromotionTarget(execution);
      setDisplayName(execution.displayName ?? `${execution.title} · v${execution.sequence}`);
      setTags(execution.tags.join(', '));
      setUserNote(execution.userNote ?? '');
    };
    const promote = async () => {
      if (!promotionTarget || !displayName.trim()) {
        return;
      }
      await store.promoteExecution(promotionTarget.id, {
        displayName: displayName.trim(),
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 10),
        ...(userNote.trim() ? { userNote: userNote.trim() } : {}),
      });
      setPromotionTarget(null);
    };

    return (
      <>
        <Drawer
          className="jx-researchExecution"
          width={760}
          open={open}
          onClose={onClose}
          title={
            selectedExecutionId ? (
              <div className="jx-researchExecution-drawerTitle">
                <Tooltip title={t('workbench.execution.backToHistory')}>
                  <Button
                    type="text"
                    size="small"
                    icon={<FontAwesomeIcon icon={faArrowLeft} />}
                    aria-label={t('workbench.execution.backToHistory')}
                    onClick={() => setSelectedExecutionId(null)}
                  />
                </Tooltip>
                <span>{t('workbench.execution.snapshotTitle')}</span>
              </div>
            ) : (
              t('workbench.execution.historyTitle')
            )
          }
          data-testid="research-execution-drawer"
        >
          {selectedExecutionId ? (
            <LoadingArea
              loader={store.executionLoader}
              loading={() => <Skeleton active paragraph={{ rows: 8 }} />}
            >
              {selectedExecution && (
                <ExecutionDetail
                  execution={selectedExecution}
                  currentContentRevision={store.document?.contentRevision}
                  onPromote={() => openPromotion(selectedExecution)}
                />
              )}
            </LoadingArea>
          ) : (
            <LoadingArea
              loader={store.executionListLoader}
              isEmpty={executions.length === 0}
              loading={() => <Skeleton active paragraph={{ rows: 6 }} />}
            >
              {executions.length === 0 ? (
                <Empty description={t('workbench.execution.empty')} />
              ) : (
                <div className="jx-researchExecution-list">
                  {executions.map((execution) => (
                    <ExecutionListItem
                      key={execution.id}
                      execution={execution}
                      currentContentRevision={store.document?.contentRevision}
                      onOpen={() => openExecution(execution.id)}
                      onPromote={() => openPromotion(execution)}
                    />
                  ))}
                </div>
              )}
            </LoadingArea>
          )}
          {(store.executionListLoader.error ||
            store.executionLoader.error ||
            store.executionPromotionLoader.error) && (
            <Alert
              className="jx-researchExecution-alert"
              type="error"
              showIcon
              title={
                store.executionListLoader.errorObject?.message ??
                store.executionLoader.errorObject?.message ??
                store.executionPromotionLoader.errorObject?.message
              }
            />
          )}
        </Drawer>
        <Modal
          open={Boolean(promotionTarget)}
          title={t('workbench.execution.promoteTitle')}
          okText={t('workbench.execution.promoteConfirm')}
          cancelText={t('workbench.execution.cancel')}
          confirmLoading={store.executionPromotionLoader.loading}
          okButtonProps={{ disabled: !displayName.trim() }}
          onOk={() => void promote()}
          onCancel={() => setPromotionTarget(null)}
        >
          <div className="jx-researchExecution-promotionForm">
            <label>
              <span>{t('workbench.execution.name')}</span>
              <Input
                value={displayName}
                maxLength={160}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label>
              <span>{t('workbench.execution.tags')}</span>
              <Input
                value={tags}
                maxLength={400}
                placeholder={t('workbench.execution.tagsPlaceholder')}
                onChange={(e) => setTags(e.target.value)}
              />
            </label>
            <label>
              <span>{t('workbench.execution.note')}</span>
              <Input.TextArea
                value={userNote}
                maxLength={2_000}
                autoSize={{ minRows: 3, maxRows: 7 }}
                onChange={(e) => setUserNote(e.target.value)}
              />
            </label>
          </div>
        </Modal>
      </>
    );
  },
  'ResearchExecutionDrawer',
);

// —— Execution views ——

function ExecutionListItem({
  execution,
  currentContentRevision,
  onOpen,
  onPromote,
}: {
  execution: ResearchExecutionSummaryV1;
  currentContentRevision?: number;
  onOpen: () => void;
  onPromote: () => void;
}) {
  const { t } = useTranslation('research');
  const draftChanged = currentContentRevision !== execution.contentRevision;
  return (
    <article
      className="jx-researchExecution-item"
      data-testid="research-execution-item"
      onClick={onOpen}
    >
      <div className="jx-researchExecution-itemIcon">
        <FontAwesomeIcon
          icon={executionStatusIcon(execution.status)}
          spin={execution.status === 'running'}
        />
      </div>
      <div className="jx-researchExecution-itemBody">
        <div className="jx-researchExecution-itemTitleRow">
          <strong>
            {execution.displayName ??
              t('workbench.execution.runName', { sequence: execution.sequence })}
          </strong>
          {execution.promotedAt && <Tag>{t('workbench.execution.promoted')}</Tag>}
        </div>
        <span className="jx-researchExecution-itemMeta">
          {t(`workbench.execution.status.${execution.status}`)} ·{' '}
          {t('workbench.execution.revision', { revision: execution.contentRevision })} ·{' '}
          {t('workbench.execution.cellProgress', {
            executed: execution.executedCellCount,
            total: execution.cellCount,
          })}
        </span>
        <span className="jx-researchExecution-itemMeta">
          {formatExecutionTime(execution.startedAt)}
          {draftChanged && ` · ${t('workbench.execution.draftChanged')}`}
        </span>
      </div>
      {execution.status === 'success' && !execution.promotedAt && (
        <Tooltip title={t('workbench.execution.promote')}>
          <Button
            type="text"
            size="small"
            icon={<FontAwesomeIcon icon={faBookmark} />}
            aria-label={t('workbench.execution.promote')}
            data-testid="research-execution-promote"
            onClick={(event) => {
              event.stopPropagation();
              onPromote();
            }}
          />
        </Tooltip>
      )}
    </article>
  );
}

function ExecutionDetail({
  execution,
  currentContentRevision,
  onPromote,
}: {
  execution: ResearchExecutionV1;
  currentContentRevision?: number;
  onPromote: () => void;
}) {
  const { t } = useTranslation('research');
  return (
    <div className="jx-researchExecution-detail" data-testid="research-execution-detail">
      <section className="jx-researchExecution-summary">
        <div className="jx-researchExecution-summaryTitleRow">
          <div>
            <h2>{execution.displayName ?? execution.title}</h2>
            <p>
              {t('workbench.execution.runName', { sequence: execution.sequence })} ·{' '}
              {t('workbench.execution.revision', { revision: execution.contentRevision })} ·{' '}
              {formatExecutionTime(execution.startedAt)}
            </p>
          </div>
          {execution.status === 'success' && !execution.promotedAt && (
            <Tooltip title={t('workbench.execution.promote')}>
              <Button
                type="text"
                icon={<FontAwesomeIcon icon={faBookmark} />}
                aria-label={t('workbench.execution.promote')}
                onClick={onPromote}
              />
            </Tooltip>
          )}
        </div>
        <div className="jx-researchExecution-summaryTags">
          <Tag color={execution.status === 'success' ? 'success' : 'default'}>
            {t(`workbench.execution.status.${execution.status}`)}
          </Tag>
          {execution.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
        {currentContentRevision !== execution.contentRevision && (
          <Alert type="info" showIcon title={t('workbench.execution.snapshotNotice')} />
        )}
        {execution.userNote && (
          <p className="jx-researchExecution-userNote">{execution.userNote}</p>
        )}
        {execution.error && <Alert type="error" showIcon title={execution.error} />}
        <dl className="jx-researchExecution-fingerprints">
          <div>
            <dt>{t('workbench.execution.sourceHash')}</dt>
            <dd>{shortFingerprint(execution.sourceHash)}</dd>
          </div>
          <div>
            <dt>{t('workbench.execution.environment')}</dt>
            <dd>{shortFingerprint(execution.environmentFingerprint)}</dd>
          </div>
        </dl>
      </section>
      <div className="jx-researchExecution-cells">
        {execution.cells.map((cell) => (
          <ExecutionCell key={cell.cellId} executionId={execution.id} cell={cell} />
        ))}
      </div>
    </div>
  );
}

function ExecutionCell({
  executionId,
  cell,
}: {
  executionId: string;
  cell: ResearchExecutionCellV1;
}) {
  const { t } = useTranslation('research');
  return (
    <article className="jx-researchExecution-cell">
      <header>
        <span>
          <FontAwesomeIcon icon={cellKindIcon(cell.kind)} />
          {t(`workbench.cellKind.${cell.kind}`)} {String(cell.position + 1).padStart(2, '0')}
        </span>
        <Tag>{t(`workbench.execution.cellStatus.${cell.status}`)}</Tag>
      </header>
      <div className="jx-researchExecution-cellSource">
        {cell.kind === 'markdown' ? (
          <Markdown text={cell.source} />
        ) : (
          <Suspense fallback={<Skeleton active paragraph={{ rows: 4 }} />}>
            <ResearchReadOnlyCodeEditor
              executionId={executionId}
              cellId={cell.cellId}
              value={cell.source}
              language="python"
            />
          </Suspense>
        )}
      </div>
      {cell.error && <Alert type="error" showIcon title={cell.error} />}
      <ResearchOutputs outputs={cell.outputs} />
    </article>
  );
}

// —— Helpers ——

function executionStatusIcon(status: ResearchExecutionStatusV1) {
  switch (status) {
    case 'success':
      return faCheck;
    case 'running':
      return faSpinner;
    case 'error':
      return faCircleExclamation;
    case 'cancelled':
      return faClock;
  }
}

function cellKindIcon(kind: ResearchExecutionCellV1['kind']) {
  switch (kind) {
    case 'markdown':
      return faFileLines;
    case 'python':
      return faCode;
  }
}

function formatExecutionTime(value: string): string {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortFingerprint(value?: string): string {
  return value ? `${value.slice(0, 12)}…` : '—';
}
