import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Input, Popconfirm, Skeleton, Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type {
  ChatMessage,
  ResearchCellKindV1,
  ResearchCellOutputBlockV1,
  ResearchCellStatusV1,
  ResearchCellV1,
  ResearchDocumentSummaryV1,
} from '@jixie/shared';
import {
  faBolt,
  faChartLine,
  faCheck,
  faCircleExclamation,
  faClockRotateLeft,
  faCode,
  faCommentDots,
  faDatabase,
  faDiagramProject,
  faEye,
  faEyeSlash,
  faFileLines,
  faFlask,
  faListCheck,
  faPaperPlane,
  faPen,
  faPlay,
  faPlus,
  faRotate,
  faStop,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AgentPending } from '@src/components/agent-pending';
import { MessageParts } from '@src/components/message-parts';
import { Markdown } from '@src/components/markdown';
import { LoadingArea } from '@src/components/loading-area';
import { researchArtifactUrl } from '@src/api/client';
import { complex } from './complex';
import { ResearchCuratorDrawer } from './research-curator-drawer';
import { ResearchDataCatalogDrawer } from './research-data-catalog-drawer';
import { ResearchCellTable } from './research-cell-table';
import './research.css';

const ResearchCodeEditor = lazy(() => import('./research-code-editor'));
const ResearchCellChart = lazy(() => import('./research-cell-chart'));

export const Research = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [dataCatalogOpen, setDataCatalogOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(true);
  return (
    <main className="jx-research">
      <ResearchSidebar
        mobileOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenCurator={() => setCuratorOpen(true)}
      />
      {historyOpen && (
        <button
          className="jx-research-sidebarBackdrop"
          onClick={() => setHistoryOpen(false)}
          aria-label={t('closeHistory')}
        />
      )}
      <section className="jx-research-main">
        {store.document ? (
          <ResearchWorkspace
            agentOpen={agentOpen}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenDataCatalog={() => setDataCatalogOpen(true)}
            onToggleAgent={() => setAgentOpen((value) => !value)}
          />
        ) : (
          <ResearchLanding onOpenHistory={() => setHistoryOpen(true)} />
        )}
      </section>
      {store.document && agentOpen && <ResearchAgentPanel />}
      <ResearchCuratorDrawer open={curatorOpen} onClose={() => setCuratorOpen(false)} />
      <ResearchDataCatalogDrawer open={dataCatalogOpen} onClose={() => setDataCatalogOpen(false)} />
    </main>
  );
}, 'Research');

// —— Sidebar ——

const ResearchSidebar = complex.component(
  ({
    mobileOpen,
    onClose,
    onOpenCurator,
  }: {
    mobileOpen: boolean;
    onClose: () => void;
    onOpenCurator: () => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    const documents = store.documentsLoader.result ?? [];
    return (
      <aside
        className={classNames('jx-research-sidebar', {
          'jx-research-sidebar--open': mobileOpen,
        })}
      >
        <div className="jx-research-sidebarHead">
          <div className="jx-research-sidebarTitleRow">
            <h1 className="jx-research-sidebarTitle">
              <FontAwesomeIcon icon={faFlask} /> {t('title')}
            </h1>
            <div className="jx-research-sidebarActions">
              <Tooltip title={t('workbench.newDocument')}>
                <Button
                  type="text"
                  size="small"
                  icon={<FontAwesomeIcon icon={faPlus} />}
                  aria-label={t('workbench.newDocument')}
                  onClick={() => {
                    store.newDocument();
                    onClose();
                  }}
                />
              </Tooltip>
              <Tooltip title={t('curator.open')}>
                <Button
                  type="text"
                  size="small"
                  icon={<FontAwesomeIcon icon={faListCheck} />}
                  aria-label={t('curator.open')}
                  onClick={() => {
                    onOpenCurator();
                    onClose();
                  }}
                />
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="jx-research-sidebarScroll">
          <h2 className="jx-research-sidebarLabel">{t('workbench.documents')}</h2>
          <LoadingArea
            loader={store.documentsLoader}
            isEmpty={documents.length === 0}
            showDelay={0}
            minimumVisibleDuration={200}
            loading={() => (
              <div className="jx-research-sidebarSkeleton">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} active paragraph={{ rows: 1 }} title={false} />
                ))}
              </div>
            )}
          >
            {documents.length === 0 ? (
              <p className="jx-research-sidebarEmpty">{t('workbench.emptyDocuments')}</p>
            ) : (
              documents.map((document) => (
                <DocumentItem key={document.id} document={document} onSelect={onClose} />
              ))
            )}
          </LoadingArea>
        </div>
      </aside>
    );
  },
  'ResearchSidebar',
);

const DocumentItem = complex.component(
  ({ document, onSelect }: { document: ResearchDocumentSummaryV1; onSelect: () => void }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    return (
      <div
        className={classNames('jx-research-historyItem', {
          'jx-research-historyItem--active': store.documentId === document.id,
        })}
        onClick={() => {
          void store.openDocument(document.id);
          onSelect();
        }}
      >
        <div className="jx-research-historyText">
          <div className="jx-research-historyTitle">{document.title}</div>
          <div className="jx-research-historyPreview">
            {document.staleCount > 0
              ? t('workbench.staleSummary', { count: document.staleCount })
              : t('workbench.cellSummary', { count: document.cellCount })}
          </div>
        </div>
        <Tooltip title={t('deleteChat')}>
          <Popconfirm
            title={t('deleteChat')}
            onConfirm={() => store.removeConversation(document.id)}
            onPopupClick={(event) => event.stopPropagation()}
          >
            <Button
              type="text"
              size="small"
              className="jx-research-historyDelete jx-research-destructiveAction"
              icon={<FontAwesomeIcon icon={faTrash} />}
              onClick={(event) => event.stopPropagation()}
              aria-label={t('deleteChat')}
            />
          </Popconfirm>
        </Tooltip>
      </div>
    );
  },
  'DocumentItem',
);

// —— Landing ——

const ResearchLanding = complex.component(({ onOpenHistory }: { onOpenHistory: () => void }) => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  return (
    <div className="jx-research-landing">
      <Tooltip title={t('history')}>
        <Button
          type="text"
          className="jx-research-mobileHistory"
          size="small"
          icon={<FontAwesomeIcon icon={faClockRotateLeft} />}
          aria-label={t('history')}
          onClick={onOpenHistory}
        />
      </Tooltip>
      <div className="jx-research-landingIntro">
        <div className="jx-research-heroIcon">
          <FontAwesomeIcon icon={faFlask} />
        </div>
        <Tag className="jx-research-landingTag">{t('workbench.reactive')}</Tag>
        <h2>{t('workbench.heroTitle')}</h2>
        <p>{t('workbench.heroHint')}</p>
      </div>
      <div className="jx-research-templateGrid">
        <button
          className="jx-research-templateCard jx-research-templateCard--featured"
          data-testid="research-template-index_relationship"
          onClick={() => void store.createDocument('index_relationship')}
        >
          <span className="jx-research-templateIcon">
            <FontAwesomeIcon icon={faChartLine} />
          </span>
          <strong>{t('workbench.template.relationshipTitle')}</strong>
          <span>{t('workbench.template.relationshipDescription')}</span>
          <small>{t('workbench.template.relationshipMeta')}</small>
        </button>
        <button
          className="jx-research-templateCard"
          data-testid="research-template-blank"
          onClick={() => void store.createDocument('blank')}
        >
          <span className="jx-research-templateIcon">
            <FontAwesomeIcon icon={faFileLines} />
          </span>
          <strong>{t('workbench.template.blankTitle')}</strong>
          <span>{t('workbench.template.blankDescription')}</span>
          <small>{t('workbench.template.blankMeta')}</small>
        </button>
      </div>
      {store.documentMutationLoader.error && (
        <Alert type="error" showIcon title={store.documentMutationLoader.errorObject?.message} />
      )}
    </div>
  );
}, 'ResearchLanding');

// —— Document workspace ——

const ResearchWorkspace = complex.component(
  ({
    agentOpen,
    onOpenHistory,
    onOpenDataCatalog,
    onToggleAgent,
  }: {
    agentOpen: boolean;
    onOpenHistory: () => void;
    onOpenDataCatalog: () => void;
    onToggleAgent: () => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    const [editingTitle, setEditingTitle] = useState(false);
    const [title, setTitle] = useState('');
    const document = store.document!;
    const staleCount = document.cells.filter((cell) => cell.status === 'stale').length;
    const commitTitle = () => {
      setEditingTitle(false);
      void store.renameConversation(title);
    };
    const addMenu = {
      items: (['markdown', 'python', 'validation'] as ResearchCellKindV1[]).map((kind) => ({
        key: kind,
        label: t(`workbench.cellKind.${kind}`),
        onClick: (): void => {
          void store.addCell(kind);
        },
      })),
    };
    return (
      <div className="jx-research-workspace">
        <header className="jx-research-header">
          <Tooltip title={t('history')}>
            <Button
              type="text"
              className="jx-research-mobileHistory"
              size="small"
              icon={<FontAwesomeIcon icon={faClockRotateLeft} />}
              aria-label={t('history')}
              onClick={onOpenHistory}
            />
          </Tooltip>
          <div className="jx-research-titleBlock">
            {editingTitle ? (
              <Input
                className="jx-research-titleInput"
                value={title}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                onBlur={commitTitle}
                onPressEnter={commitTitle}
              />
            ) : (
              <span className="jx-research-chatTitle">
                {document.title || t('chatTitleFallback')}
                <Tooltip title={t('workbench.rename')}>
                  <Button
                    type="text"
                    size="small"
                    className="jx-research-titleEdit"
                    icon={<FontAwesomeIcon icon={faPen} />}
                    onClick={() => {
                      setTitle(document.title);
                      setEditingTitle(true);
                    }}
                    aria-label={t('workbench.rename')}
                  />
                </Tooltip>
              </span>
            )}
            <span className="jx-research-runtimeMeta">
              {t('workbench.runtime')} · {document.cells.length} {t('workbench.cells')}
              {staleCount > 0 && ` · ${t('workbench.staleSummary', { count: staleCount })}`}
            </span>
          </div>
          <div className="jx-research-toolbar">
            <Tooltip title={t('dataCatalog.open')}>
              <Button
                type="text"
                size="small"
                icon={<FontAwesomeIcon icon={faDatabase} />}
                aria-label={t('dataCatalog.open')}
                data-testid="research-open-data-catalog"
                onClick={onOpenDataCatalog}
              />
            </Tooltip>
            <Tooltip title={t('workbench.resetHint')}>
              <Button
                type="text"
                size="small"
                disabled={store.hasActiveRun}
                icon={<FontAwesomeIcon icon={faRotate} />}
                aria-label={t('workbench.reset')}
                onClick={() => void store.resetRuntime()}
              />
            </Tooltip>
            <Tooltip
              title={store.hasActiveRun ? t('workbench.interruptRun') : t('workbench.cleanRun')}
            >
              <Button
                type="text"
                size="small"
                className={classNames({
                  'jx-research-interruptAction': store.hasActiveRun,
                })}
                data-testid={store.hasActiveRun ? 'research-interrupt' : 'research-run-all'}
                disabled={store.interrupting}
                icon={<FontAwesomeIcon icon={store.hasActiveRun ? faStop : faBolt} />}
                aria-label={
                  store.hasActiveRun ? t('workbench.interruptRun') : t('workbench.cleanRun')
                }
                onClick={() =>
                  void (store.hasActiveRun ? store.interruptRun() : store.runAll(true))
                }
              />
            </Tooltip>
            <Tooltip title={agentOpen ? t('workbench.hideAgent') : t('workbench.showAgent')}>
              <Button
                type="text"
                size="small"
                className="jx-research-agentToggle"
                icon={<FontAwesomeIcon icon={faCommentDots} />}
                aria-label={agentOpen ? t('workbench.hideAgent') : t('workbench.showAgent')}
                onClick={onToggleAgent}
              />
            </Tooltip>
          </div>
        </header>
        {(store.documentMutationLoader.error ||
          store.documentRunLoader.error ||
          store.affectedRunLoader.error ||
          store.interruptLoader.error) && (
          <Alert
            className="jx-research-workspaceAlert"
            type="error"
            showIcon
            title={
              store.documentMutationLoader.errorObject?.message ??
              store.documentRunLoader.errorObject?.message ??
              store.affectedRunLoader.errorObject?.message ??
              store.interruptLoader.errorObject?.message
            }
          />
        )}
        {store.runInterrupted && (
          <Alert
            className="jx-research-workspaceAlert"
            type="info"
            showIcon
            closable
            title={t('workbench.runInterrupted')}
            onClose={() => store.clearRunInterrupted()}
          />
        )}
        <div className="jx-research-documentScroll">
          <div className="jx-research-document" data-testid="research-document">
            {document.cells.map((cell, index) => (
              <ResearchCell key={cell.id} cell={cell} ordinal={index + 1} />
            ))}
            <Tooltip title={t('workbench.addCell')}>
              <Dropdown menu={addMenu} trigger={['click']}>
                <Button
                  type="text"
                  className="jx-research-addCell"
                  disabled={store.hasActiveRun}
                  icon={<FontAwesomeIcon icon={faPlus} />}
                  aria-label={t('workbench.addCell')}
                />
              </Dropdown>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  },
  'ResearchWorkspace',
);

const ResearchCell = complex.component(
  ({ cell, ordinal }: { cell: ResearchCellV1; ordinal: number }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    const [draft, setDraft] = useState(cell.source);
    const [markdownEditing, setMarkdownEditing] = useState(false);
    const [validationSourceOpen, setValidationSourceOpen] = useState(cell.status !== 'success');
    useEffect(() => {
      setDraft(cell.source);
    }, [cell.source, cell.revision]);
    const busy = store.busyCellId === cell.id || cell.status === 'running';
    const cellRunActive = store.busyCellId === cell.id;
    const affectedBusy = store.affectedRunningCellId === cell.id;
    const anotherRunActive =
      store.documentRunning ||
      (store.busyCellId !== null && store.busyCellId !== cell.id) ||
      (store.affectedRunningCellId !== null && store.affectedRunningCellId !== cell.id);
    const dirty = draft !== cell.source;
    const run = (): void => {
      void store.runCell(cell.id, draft);
    };
    const save = (): void => {
      if (dirty) {
        void store.updateCell(cell.id, draft);
      }
    };
    const runAffected = (): void => {
      void store.runAffected(cell.id, draft);
    };
    return (
      <article
        className={classNames('jx-research-cell', `jx-research-cell--${cell.status}`)}
        data-testid={`research-cell-${cell.kind}`}
        data-cell-id={cell.id}
      >
        <header className="jx-research-cellHead">
          <div className="jx-research-cellIdentity">
            <span className={`jx-research-cellKind jx-research-cellKind--${cell.kind}`}>
              <FontAwesomeIcon icon={cellIcon(cell.kind)} />
              {t(`workbench.cellKind.${cell.kind}`)}
            </span>
            <span className="jx-research-cellOrdinal">{ordinal.toString().padStart(2, '0')}</span>
            <CellStatus status={dirty ? 'stale' : cell.status} />
          </div>
          <div className="jx-research-cellActions">
            {cell.kind === 'markdown' && (
              <Tooltip title={markdownEditing ? t('workbench.preview') : t('workbench.edit')}>
                <Button
                  type="text"
                  size="small"
                  icon={<FontAwesomeIcon icon={markdownEditing ? faEye : faPen} />}
                  aria-label={markdownEditing ? t('workbench.preview') : t('workbench.edit')}
                  onClick={() => setMarkdownEditing((value) => !value)}
                />
              </Tooltip>
            )}
            {cell.kind === 'validation' && (
              <Tooltip
                title={validationSourceOpen ? t('workbench.hideSpec') : t('workbench.showSpec')}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<FontAwesomeIcon icon={validationSourceOpen ? faEyeSlash : faCode} />}
                  aria-label={
                    validationSourceOpen ? t('workbench.hideSpec') : t('workbench.showSpec')
                  }
                  onClick={() => setValidationSourceOpen((value) => !value)}
                />
              </Tooltip>
            )}
            <Tooltip
              title={
                cell.kind === 'python' && cellRunActive
                  ? t('workbench.interruptRun')
                  : t('workbench.runShortcut')
              }
            >
              <Button
                type="text"
                size="small"
                className={classNames({
                  'jx-research-interruptAction': cell.kind === 'python' && cellRunActive,
                })}
                loading={busy && !(cell.kind === 'python' && cellRunActive)}
                disabled={
                  store.interrupting ||
                  (!(cell.kind === 'python' && cellRunActive) && (affectedBusy || anotherRunActive))
                }
                icon={
                  <FontAwesomeIcon
                    icon={cell.kind === 'python' && cellRunActive ? faStop : faPlay}
                  />
                }
                aria-label={
                  cell.kind === 'python' && cellRunActive
                    ? t('workbench.interruptRun')
                    : t('workbench.runCell')
                }
                onClick={() =>
                  void (cell.kind === 'python' && cellRunActive ? store.interruptRun() : run())
                }
              />
            </Tooltip>
            {cell.kind === 'python' && (
              <Tooltip
                title={affectedBusy ? t('workbench.interruptRun') : t('workbench.runAffected')}
              >
                <Button
                  type="text"
                  size="small"
                  className={classNames({
                    'jx-research-interruptAction': affectedBusy,
                  })}
                  disabled={store.interrupting || (!affectedBusy && (busy || anotherRunActive))}
                  data-testid="research-run-affected"
                  icon={<FontAwesomeIcon icon={affectedBusy ? faStop : faDiagramProject} />}
                  aria-label={
                    affectedBusy ? t('workbench.interruptRun') : t('workbench.runAffected')
                  }
                  onClick={() => void (affectedBusy ? store.interruptRun() : runAffected())}
                />
              </Tooltip>
            )}
            <Tooltip title={t('workbench.deleteCell')}>
              <Popconfirm
                title={t('workbench.deleteCell')}
                onConfirm={() => void store.deleteCell(cell.id)}
              >
                <Button
                  type="text"
                  size="small"
                  className="jx-research-destructiveAction"
                  disabled={store.hasActiveRun}
                  icon={<FontAwesomeIcon icon={faTrash} />}
                  aria-label={t('workbench.deleteCell')}
                />
              </Popconfirm>
            </Tooltip>
          </div>
        </header>
        <div className="jx-research-cellBody">
          {cell.kind === 'markdown' ? (
            markdownEditing ? (
              <Input.TextArea
                className="jx-research-markdownEditor"
                autoSize={{ minRows: 5, maxRows: 18 }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={save}
              />
            ) : (
              <div className="jx-research-markdownPreview">
                <Markdown text={draft} />
              </div>
            )
          ) : cell.kind === 'python' || validationSourceOpen ? (
            <Suspense fallback={<div className="jx-research-editorPending" />}>
              <ResearchCodeEditor
                documentId={cell.documentId}
                cellId={cell.id}
                cells={(store.document?.cells ?? [])
                  .filter((candidate) => candidate.kind === 'python')
                  .map((candidate) => ({ id: candidate.id, source: candidate.source }))}
                value={draft}
                language={cell.kind === 'validation' ? 'json' : 'python'}
                onChange={setDraft}
                onBlur={save}
                onRun={run}
              />
            </Suspense>
          ) : null}
          {cell.status === 'stale' && cell.outputs.length > 0 && (
            <div className="jx-research-staleNotice">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{t('workbench.staleNotice')}</span>
            </div>
          )}
          <ResearchOutputs outputs={cell.outputs} />
        </div>
        {cell.kind === 'python' && (cell.definitions.length > 0 || cell.references.length > 0) && (
          <footer className="jx-research-cellDeps">
            {cell.definitions.length > 0 && (
              <span>
                {t('workbench.defines')} <code>{cell.definitions.join(', ')}</code>
              </span>
            )}
            {cell.references.length > 0 && (
              <span>
                {t('workbench.uses')} <code>{cell.references.join(', ')}</code>
              </span>
            )}
          </footer>
        )}
      </article>
    );
  },
  'ResearchCell',
);

function CellStatus({ status }: { status: ResearchCellStatusV1 }) {
  const { t } = useTranslation('research');
  return (
    <span className={`jx-research-cellStatus jx-research-cellStatus--${status}`}>
      <FontAwesomeIcon icon={statusIcon(status)} />
      {t(`workbench.status.${status}`)}
    </span>
  );
}

function ResearchOutputs({ outputs }: { outputs: ResearchCellOutputBlockV1[] }) {
  if (outputs.length === 0) {
    return null;
  }
  return (
    <div className="jx-research-outputs">
      {outputs.map((output, index) => (
        <ResearchOutput key={index} output={output} />
      ))}
    </div>
  );
}

function ResearchOutput({ output }: { output: ResearchCellOutputBlockV1 }) {
  const { t } = useTranslation('research');
  switch (output.type) {
    case 'text':
      return (
        <pre className={`jx-research-textOutput jx-research-textOutput--${output.level ?? 'info'}`}>
          {output.text}
        </pre>
      );
    case 'value':
      return <pre className="jx-research-valueOutput">{JSON.stringify(output.value, null, 2)}</pre>;
    case 'table':
      return <ResearchCellTable output={output} />;
    case 'chart':
      return (
        <section className="jx-research-chartOutput" data-testid="research-interactive-chart">
          <Suspense fallback={<div className="jx-research-chartPending" />}>
            <ResearchCellChart chart={output} />
          </Suspense>
        </section>
      );
    case 'image': {
      const source = output.artifactId ? researchArtifactUrl(output.artifactId) : output.dataUrl;
      return source ? (
        <figure className="jx-research-imageOutput" data-testid="research-image-output">
          <img
            src={source}
            alt={output.alt ?? t('workbench.pythonFigure')}
            loading="lazy"
            decoding="async"
            {...(output.width ? { width: output.width } : {})}
            {...(output.height ? { height: output.height } : {})}
          />
        </figure>
      ) : null;
    }
    case 'validation':
      return (
        <div className="jx-research-validationOutput" data-testid="research-validation-output">
          <div className="jx-research-evidenceLabel">
            <FontAwesomeIcon icon={faCheck} /> {t('workbench.formalEvidence')}
          </div>
          <MessageParts
            message={
              {
                role: 'assistant',
                parts: [
                  {
                    type: 'research',
                    title: output.title,
                    run: output.run,
                    record: output.record,
                  },
                ],
              } as ChatMessage
            }
          />
        </div>
      );
  }
}

// —— Agent panel ——

const ResearchAgentPanel = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [store.chatMessages.length]);
  return (
    <aside className="jx-research-agentPanel">
      <header className="jx-research-agentHead">
        <span className="jx-research-agentAvatar">
          <FontAwesomeIcon icon={faCommentDots} />
        </span>
        <div>
          <strong>{t('workbench.agentTitle')}</strong>
          <span>{t('workbench.agentContext')}</span>
        </div>
      </header>
      <div className="jx-research-agentMessages">
        {store.chatMessages.length === 0 && (
          <div className="jx-research-agentEmpty">
            <FontAwesomeIcon icon={faFlask} />
            <strong>{t('workbench.agentEmptyTitle')}</strong>
            <p>{t('workbench.agentEmptyHint')}</p>
          </div>
        )}
        {store.chatMessages.map((message, index) => (
          <div
            key={message.id ?? index}
            className={classNames(
              'jx-research-agentMessage',
              `jx-research-agentMessage--${message.role}`,
            )}
          >
            <MessageParts message={message} />
          </div>
        ))}
        {store.sending && <AgentPending stream={store.turnStream} />}
        <div ref={endRef} />
      </div>
      <div className="jx-research-agentComposer">
        <Input.TextArea
          value={store.prompt}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder={t('workbench.agentPlaceholder')}
          onChange={(event) => store.setPrompt(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void store.send(store.prompt);
            }
          }}
        />
        <Tooltip title={t('workbench.sendAgent')}>
          <Button
            type="text"
            loading={store.sending}
            disabled={!store.prompt.trim()}
            icon={<FontAwesomeIcon icon={faPaperPlane} />}
            aria-label={t('workbench.sendAgent')}
            onClick={() => void store.send(store.prompt)}
          />
        </Tooltip>
      </div>
    </aside>
  );
}, 'ResearchAgentPanel');

// —— Helpers ——

function cellIcon(kind: ResearchCellKindV1) {
  switch (kind) {
    case 'markdown':
      return faFileLines;
    case 'python':
      return faCode;
    case 'validation':
      return faFlask;
  }
}

function statusIcon(status: ResearchCellStatusV1) {
  switch (status) {
    case 'success':
      return faCheck;
    case 'stale':
      return faTriangleExclamation;
    case 'error':
      return faCircleExclamation;
    case 'running':
      return faBolt;
    case 'idle':
      return faClockRotateLeft;
  }
}
