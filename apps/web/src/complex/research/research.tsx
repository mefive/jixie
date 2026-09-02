import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Alert,
  App,
  Button,
  Dropdown,
  Input,
  Popconfirm,
  Segmented,
  Skeleton,
  Splitter,
  Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { useBlocker, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import type {
  ResearchCellKindV1,
  ResearchCellStatusV1,
  ResearchCellV1,
  ResearchDocumentListStateV1,
  ResearchDocumentSummaryV1,
} from '@jixie/shared';
import {
  faBoxArchive,
  faBoxOpen,
  faBolt,
  faArrowLeft,
  faCheck,
  faCircleExclamation,
  faClockRotateLeft,
  faCode,
  faCodeCompare,
  faCommentDots,
  faDatabase,
  faDiagramProject,
  faEye,
  faFileLines,
  faFlask,
  faListCheck,
  faEllipsisVertical,
  faMagnifyingGlass,
  faPaperPlane,
  faPen,
  faPlay,
  faPlus,
  faRotate,
  faSpinner,
  faStop,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AgentPending } from '@src/components/agent-pending';
import { MessageParts } from '@src/components/message-parts';
import { Markdown } from '@src/components/markdown';
import { LoadingArea } from '@src/components/loading-area';
import { complex } from './complex';
import { ResearchCuratorDrawer } from './research-curator-drawer';
import { ResearchDataCatalogDrawer } from './research-data-catalog-drawer';
import { ResearchExecutionDrawer } from './research-execution-drawer';
import { ResearchOutputs } from './research-outputs';
import type { ResearchCellSaveStatus } from './research-autosave';
import './research.css';

const researchCodeEditorModule = import('./research-code-editor');
const ResearchCodeEditor = lazy(() => researchCodeEditorModule);
const ResearchCodeDiffEditor = lazy(() =>
  researchCodeEditorModule.then((module) => ({
    default: module.ResearchCodeDiffEditor,
  })),
);
export const Research = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [dataCatalogOpen, setDataCatalogOpen] = useState(false);
  const [executionHistoryOpen, setExecutionHistoryOpen] = useState(
    Boolean(store.requestedExecutionId),
  );
  const [agentOpen, setAgentOpen] = useState(defaultAgentOpen);
  const [panelDefaults] = useState(() => researchSplitterDefaults(320));
  useEffect(() => {
    if (store.requestedBacktestReportId && store.documentId) {
      navigate(`/research?document=${encodeURIComponent(store.documentId)}`, { replace: true });
      store.clearRequestedBacktestReport();
    }
  }, [navigate, store, store.documentId, store.requestedBacktestReportId]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      store.hasUnsavedDrafts && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return;
    }
    let active = true;
    void store.flushPendingChanges().then((saved) => {
      if (!active) {
        return;
      }
      if (saved) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
    return () => {
      active = false;
    };
  }, [blocker, store]);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 920px)');
    const closeAgentOnNarrowViewport = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setAgentOpen(false);
      }
    };

    mediaQuery.addEventListener('change', closeAgentOnNarrowViewport);
    return () => mediaQuery.removeEventListener('change', closeAgentOnNarrowViewport);
  }, []);
  const openHistory = () => {
    setAgentOpen(false);
    setHistoryOpen(true);
  };
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
      <Splitter className="jx-research-content">
        <Splitter.Panel className="jx-research-mainPane" defaultSize={panelDefaults.main} min="42%">
          <section className="jx-research-main">
            {store.document ? (
              <ResearchWorkspace
                agentOpen={agentOpen}
                onOpenHistory={openHistory}
                onOpenDataCatalog={() => setDataCatalogOpen(true)}
                onOpenExecutionHistory={() => setExecutionHistoryOpen(true)}
                onToggleAgent={() => setAgentOpen((value) => !value)}
              />
            ) : (
              <ResearchLanding onOpenHistory={openHistory} />
            )}
          </section>
        </Splitter.Panel>
        {store.document && agentOpen && (
          <Splitter.Panel
            className="jx-research-agentPane"
            defaultSize={panelDefaults.agent}
            min={280}
            max={620}
          >
            <ResearchAgentPanel onClose={() => setAgentOpen(false)} />
          </Splitter.Panel>
        )}
      </Splitter>
      <ResearchCuratorDrawer open={curatorOpen} onClose={() => setCuratorOpen(false)} />
      <ResearchDataCatalogDrawer open={dataCatalogOpen} onClose={() => setDataCatalogOpen(false)} />
      <ResearchExecutionDrawer
        open={executionHistoryOpen}
        initialExecutionId={store.requestedExecutionId}
        onClose={() => setExecutionHistoryOpen(false)}
      />
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
    const [listState, setListState] = useState<ResearchDocumentListStateV1>('active');
    const [query, setQuery] = useState('');
    const loader = listState === 'active' ? store.documentsLoader : store.archivedDocumentsLoader;
    const documents = loader.result ?? [];
    const visibleDocuments = documents.filter((document) =>
      researchDocumentMatchesQuery(document, query),
    );
    const changeListState = (value: string | number) => {
      const nextState = value as ResearchDocumentListStateV1;
      setListState(nextState);
      if (nextState === 'archived') {
        store.loadArchivedDocuments();
      }
    };
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
                    void store.newDocument();
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
          <Segmented
            block
            className="jx-research-documentState"
            value={listState}
            options={[
              { label: t('workbench.activeDocuments'), value: 'active' },
              { label: t('workbench.archivedDocuments'), value: 'archived' },
            ]}
            onChange={changeListState}
            data-testid="research-document-state"
          />
          <Input
            allowClear
            className="jx-research-documentSearch"
            value={query}
            prefix={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            placeholder={t('workbench.searchDocuments')}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="research-document-search"
          />
        </div>
        <div className="jx-research-sidebarScroll">
          <h2 className="jx-research-sidebarLabel">
            {listState === 'active'
              ? t('workbench.activeDocuments')
              : t('workbench.archivedDocuments')}
          </h2>
          <LoadingArea
            loader={loader}
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
              <p className="jx-research-sidebarEmpty">
                {listState === 'active'
                  ? t('workbench.emptyDocuments')
                  : t('workbench.emptyArchivedDocuments')}
              </p>
            ) : visibleDocuments.length === 0 ? (
              <p className="jx-research-sidebarEmpty">{t('workbench.noDocumentMatches')}</p>
            ) : (
              visibleDocuments.map((document) => (
                <DocumentItem
                  key={document.id}
                  document={document}
                  listState={listState}
                  query={query}
                  onSelect={onClose}
                />
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
  ({
    document,
    listState,
    query,
    onSelect,
  }: {
    document: ResearchDocumentSummaryV1;
    listState: ResearchDocumentListStateV1;
    query: string;
    onSelect: () => void;
  }) => {
    const store = complex.useStore();
    const { message, modal } = App.useApp();
    const { t, i18n } = useTranslation('research');
    const isCurrentDocument = store.documentId === document.id;
    const archiveBlocked =
      store.documentManagementLoader.loading ||
      (isCurrentDocument && (store.hasActiveRun || store.sending));
    const normalizedQuery = normalizeDocumentQuery(query);
    const previewMatches =
      normalizedQuery.length > 0 &&
      !document.title.toLocaleLowerCase().includes(normalizedQuery) &&
      document.preview.toLocaleLowerCase().includes(normalizedQuery);
    const statusSummary =
      document.staleCount > 0
        ? t('workbench.staleSummary', { count: document.staleCount })
        : t('workbench.cellSummary', { count: document.cellCount });
    const secondaryText = previewMatches
      ? document.preview
      : listState === 'archived' && document.archivedAt
        ? t('workbench.archivedSummary', {
            date: formatResearchDocumentDate(document.archivedAt, i18n.language),
            summary: statusSummary,
          })
        : statusSummary;
    const archive = async () => {
      try {
        const archived = await store.archiveDocument(document.id);
        if (archived) {
          void message.success(t('workbench.archiveSuccess'));
        } else {
          void message.warning(t('workbench.archiveBlocked'));
        }
      } catch {
        void message.error(t('workbench.documentActionFailed'));
      }
    };
    const restore = async () => {
      try {
        await store.restoreDocument(document.id);
        void message.success(t('workbench.restoreSuccess'));
      } catch {
        void message.error(t('workbench.documentActionFailed'));
      }
    };
    const permanentlyDelete = () => {
      modal.confirm({
        title: t('workbench.permanentDeleteTitle'),
        content: t('workbench.permanentDeleteDescription'),
        okText: t('workbench.permanentDeleteConfirm'),
        okButtonProps: { danger: true },
        cancelText: t('workbench.cancel'),
        onOk: async () => {
          await store.permanentlyDeleteDocument(document.id);
          void message.success(t('workbench.permanentDeleteSuccess'));
        },
      });
    };
    const menu: MenuProps = {
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        switch (key) {
          case 'archive':
            void archive();
            break;
          case 'restore':
            void restore();
            break;
          case 'delete':
            permanentlyDelete();
            break;
        }
      },
      items:
        listState === 'active'
          ? [
              {
                key: 'archive',
                icon: <FontAwesomeIcon icon={faBoxArchive} />,
                label: t('workbench.archiveDocument'),
                disabled: archiveBlocked,
              },
            ]
          : [
              {
                key: 'restore',
                icon: <FontAwesomeIcon icon={faBoxOpen} />,
                label: t('workbench.restoreDocument'),
              },
              { type: 'divider' },
              {
                key: 'delete',
                danger: true,
                icon: <FontAwesomeIcon icon={faTrash} />,
                label: t('workbench.permanentlyDeleteDocument'),
              },
            ],
    };
    return (
      <div
        className={classNames('jx-research-historyItem', {
          'jx-research-historyItem--active': isCurrentDocument,
          'jx-research-historyItem--archived': listState === 'archived',
        })}
        onClick={() => {
          if (listState === 'archived') {
            return;
          }
          void store.openDocument(document.id);
          onSelect();
        }}
        data-testid={`research-document-item-${document.id}`}
      >
        <div className="jx-research-historyText">
          <div className="jx-research-historyTitle">{document.title}</div>
          <div className="jx-research-historyPreview">{secondaryText}</div>
        </div>
        <Dropdown menu={menu} trigger={['click']}>
          <Button
            type="text"
            size="small"
            className="jx-research-historyMenu"
            icon={<FontAwesomeIcon icon={faEllipsisVertical} />}
            aria-label={t('workbench.documentActions', { title: document.title })}
            onClick={(event) => event.stopPropagation()}
            data-testid={`research-document-menu-${document.id}`}
          />
        </Dropdown>
      </div>
    );
  },
  'DocumentItem',
);

function normalizeDocumentQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function researchDocumentMatchesQuery(document: ResearchDocumentSummaryV1, query: string): boolean {
  const normalizedQuery = normalizeDocumentQuery(query);
  return (
    normalizedQuery.length === 0 ||
    document.title.toLocaleLowerCase().includes(normalizedQuery) ||
    document.preview.toLocaleLowerCase().includes(normalizedQuery)
  );
}

function formatResearchDocumentDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

// —— Landing ——

const ResearchLanding = complex.component(({ onOpenHistory }: { onOpenHistory: () => void }) => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const [prompt, setPrompt] = useState('');
  const starting = store.documentMutationLoader.loading || store.sending;
  const submit = () => {
    const text = prompt.trim();
    if (text && !starting) {
      void store.createDocumentFromPrompt(text);
    }
  };
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
        <h2>{t('heroTitle')}</h2>
        <p>{t('heroHint')}</p>
      </div>
      <div className="jx-research-startBox">
        <ResearchPromptBox
          className="jx-research-startInput"
          value={prompt}
          placeholder={t('composerPlaceholder')}
          autoFocus
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={starting}
          onChange={setPrompt}
          onSubmit={submit}
        />
        <Button
          type="primary"
          shape="circle"
          className="jx-research-startSend"
          loading={starting}
          disabled={!prompt.trim()}
          icon={<FontAwesomeIcon icon={faPaperPlane} />}
          aria-label={t('workbench.startResearch')}
          onClick={submit}
        />
      </div>
      {store.documentMutationLoader.error && (
        <Alert
          className="jx-research-landingAlert"
          type="error"
          showIcon
          title={store.documentMutationLoader.errorObject?.message}
        />
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
    onOpenExecutionHistory,
    onToggleAgent,
  }: {
    agentOpen: boolean;
    onOpenHistory: () => void;
    onOpenDataCatalog: () => void;
    onOpenExecutionHistory: () => void;
    onToggleAgent: () => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    const [editingTitle, setEditingTitle] = useState(false);
    const [title, setTitle] = useState('');
    const document = store.document!;
    const latestExecution = store.executionListLoader.result?.[0];
    const staleCount = document.cells.filter((cell) => cell.status === 'stale').length;
    const commitTitle = () => {
      setEditingTitle(false);
      void store.renameConversation(title);
    };
    const addMenu = {
      items: (['markdown', 'python'] as ResearchCellKindV1[]).map((kind) => ({
        key: kind,
        label: t(`workbench.cellKind.${kind}`),
        onClick: (): void => {
          void store.addCell(kind);
        },
      })),
    };
    const mobileActionsMenu: MenuProps = {
      items: [
        {
          key: 'data_catalog',
          icon: <FontAwesomeIcon icon={faDatabase} />,
          label: t('dataCatalog.open'),
        },
        {
          key: 'execution_history',
          icon: <FontAwesomeIcon icon={faClockRotateLeft} />,
          label: t('workbench.execution.historyTitle'),
        },
        {
          key: 'reset_runtime',
          icon: <FontAwesomeIcon icon={faRotate} />,
          label: t('workbench.reset'),
          disabled: store.hasActiveRun || store.hasOpenCellChangeReview,
        },
        {
          key: 'run_document',
          icon: <FontAwesomeIcon icon={store.hasActiveRun ? faStop : faBolt} />,
          label: store.hasActiveRun ? t('workbench.interruptRun') : t('workbench.cleanRun'),
          danger: store.hasActiveRun,
          disabled: store.interrupting || store.hasOpenCellChangeReview,
        },
      ],
      onClick: ({ key }) => {
        switch (key) {
          case 'data_catalog':
            onOpenDataCatalog();
            break;
          case 'execution_history':
            onOpenExecutionHistory();
            break;
          case 'reset_runtime':
            void store.resetRuntime();
            break;
          case 'run_document':
            void (store.hasActiveRun ? store.interruptRun() : store.runAll(true));
            break;
        }
      },
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
              {latestExecution &&
                ` · ${t('workbench.execution.latest', {
                  sequence: latestExecution.sequence,
                  status: t(`workbench.execution.status.${latestExecution.status}`),
                })}`}
            </span>
          </div>
          <div className="jx-research-toolbar">
            <Dropdown menu={mobileActionsMenu} trigger={['click']}>
              <Button
                type="text"
                size="small"
                className="jx-research-mobileActions"
                icon={<FontAwesomeIcon icon={faEllipsisVertical} />}
                aria-label={t('workbench.moreActions')}
                data-testid="research-mobile-actions"
              />
            </Dropdown>
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
            <Tooltip title={t('workbench.execution.historyTitle')}>
              <Button
                type="text"
                size="small"
                icon={<FontAwesomeIcon icon={faClockRotateLeft} />}
                aria-label={t('workbench.execution.historyTitle')}
                data-testid="research-open-execution-history"
                onClick={onOpenExecutionHistory}
              />
            </Tooltip>
            <Tooltip title={t('workbench.resetHint')}>
              <Button
                type="text"
                size="small"
                disabled={store.hasActiveRun || store.hasOpenCellChangeReview}
                icon={<FontAwesomeIcon icon={faRotate} />}
                aria-label={t('workbench.reset')}
                onClick={() => void store.resetRuntime()}
              />
            </Tooltip>
            <Tooltip
              title={
                store.hasOpenCellChangeReview
                  ? t('workbench.cellChange.resolveBeforeRun')
                  : store.hasActiveRun
                    ? t('workbench.interruptRun')
                    : t('workbench.cleanRun')
              }
            >
              <Button
                type="text"
                size="small"
                className={classNames({
                  'jx-research-interruptAction': store.hasActiveRun,
                })}
                data-testid={store.hasActiveRun ? 'research-interrupt' : 'research-run-all'}
                disabled={store.interrupting || store.hasOpenCellChangeReview}
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
          store.interruptLoader.error ||
          store.cellChangeResolutionLoader.error ||
          store.cellChangeReviewResolutionLoader.error ||
          store.cellChangeRunLoader.error) && (
          <Alert
            className="jx-research-workspaceAlert"
            type="error"
            showIcon
            title={
              store.documentMutationLoader.errorObject?.message ??
              store.documentRunLoader.errorObject?.message ??
              store.affectedRunLoader.errorObject?.message ??
              store.interruptLoader.errorObject?.message ??
              store.cellChangeResolutionLoader.errorObject?.message ??
              store.cellChangeReviewResolutionLoader.errorObject?.message ??
              store.cellChangeRunLoader.errorObject?.message
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
              <ResearchCell key={`${index}:${cell.kind}`} cell={cell} ordinal={index + 1} />
            ))}
            <Tooltip title={t('workbench.addCell')}>
              <Dropdown menu={addMenu} trigger={['click']}>
                <Button
                  type="text"
                  className="jx-research-addCell"
                  disabled={store.hasActiveRun || store.hasOpenCellChangeReview}
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
    const [markdownEditing, setMarkdownEditing] = useState(false);
    const draftState = store.cellDraft(cell.id);
    const draft = draftState?.draft ?? cell.source;
    const saveStatus = draftState?.status ?? 'saved';
    const changeReview = store.cellChangeReview(cell.id);
    const activeReview = store.document?.activeCellChangeReview;
    const busy = store.busyCellId === cell.id || cell.status === 'running';
    const cellRunActive = store.busyCellId === cell.id;
    const affectedBusy = store.affectedRunningCellId === cell.id;
    const anotherRunActive =
      store.documentRunning ||
      (store.busyCellId !== null && store.busyCellId !== cell.id) ||
      (store.affectedRunningCellId !== null && store.affectedRunningCellId !== cell.id);
    const run = (): void => {
      void store.runCell(cell.id);
    };
    const save = (): void => {
      void store.flushCellDraft(cell.id);
    };
    const runAffected = (): void => {
      void store.runAffected(cell.id);
    };
    useEffect(() => {
      setMarkdownEditing(false);
    }, [cell.documentId, cell.id]);
    return (
      <article
        className={classNames('jx-research-cell', `jx-research-cell--${cell.status}`, {
          'jx-research-cell--agentReview': changeReview,
        })}
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
            <CellStatus status={cell.status} />
            <CellSaveState status={saveStatus} onRetry={() => void store.flushCellDraft(cell.id)} />
            {changeReview && (
              <span className="jx-research-cellReview" data-testid="research-cell-agent-review">
                <FontAwesomeIcon icon={faCodeCompare} />
                {t('workbench.cellChange.reviewing')}
              </span>
            )}
          </div>
          <div className="jx-research-cellActions">
            {cell.kind === 'markdown' && !changeReview && (
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
            <Tooltip
              title={
                store.hasOpenCellChangeReview
                  ? t('workbench.cellChange.resolveBeforeRun')
                  : cell.kind === 'python' && cellRunActive
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
                  store.hasOpenCellChangeReview ||
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
                title={
                  store.hasOpenCellChangeReview
                    ? t('workbench.cellChange.resolveBeforeRun')
                    : affectedBusy
                      ? t('workbench.interruptRun')
                      : t('workbench.runAffected')
                }
              >
                <Button
                  type="text"
                  size="small"
                  className={classNames({
                    'jx-research-interruptAction': affectedBusy,
                  })}
                  disabled={
                    store.hasOpenCellChangeReview ||
                    store.interrupting ||
                    (!affectedBusy && (busy || anotherRunActive))
                  }
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
                  disabled={store.hasActiveRun || store.hasOpenCellChangeReview}
                  icon={<FontAwesomeIcon icon={faTrash} />}
                  aria-label={t('workbench.deleteCell')}
                />
              </Popconfirm>
            </Tooltip>
          </div>
        </header>
        <div className="jx-research-cellBody">
          {changeReview && activeReview ? (
            <Suspense fallback={<div className="jx-research-editorPending" />}>
              <ResearchCodeDiffEditor
                documentId={cell.documentId}
                reviewId={activeReview.id}
                cellId={cell.id}
                cells={(store.document?.cells ?? [])
                  .filter((candidate) => candidate.kind === 'python')
                  .map((candidate) => ({
                    id: candidate.id,
                    source: store.cellDraft(candidate.id)?.draft ?? candidate.source,
                  }))}
                original={changeReview.beforeSource}
                value={draft}
                language={cell.kind === 'markdown' ? 'markdown' : 'python'}
                onChange={(source) => store.changeCellDraft(cell.id, source)}
                onBlur={save}
                onRun={run}
              />
            </Suspense>
          ) : cell.kind === 'markdown' ? (
            markdownEditing ? (
              <Input.TextArea
                className="jx-research-markdownEditor"
                autoSize={{ minRows: 5, maxRows: 18 }}
                value={draft}
                onChange={(event) => store.changeCellDraft(cell.id, event.target.value)}
                onBlur={save}
              />
            ) : (
              <div className="jx-research-markdownPreview">
                <Markdown text={draft} />
              </div>
            )
          ) : (
            <Suspense fallback={<div className="jx-research-editorPending" />}>
              <ResearchCodeEditor
                documentId={cell.documentId}
                cellId={cell.id}
                cells={(store.document?.cells ?? [])
                  .filter((candidate) => candidate.kind === 'python')
                  .map((candidate) => ({
                    id: candidate.id,
                    source: store.cellDraft(candidate.id)?.draft ?? candidate.source,
                  }))}
                value={draft}
                language="python"
                onChange={(source) => store.changeCellDraft(cell.id, source)}
                onBlur={save}
                onRun={run}
              />
            </Suspense>
          )}
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

function CellSaveState({
  status,
  onRetry,
}: {
  status: ResearchCellSaveStatus;
  onRetry: () => void;
}) {
  const { t } = useTranslation('research');
  const icon =
    status === 'saved'
      ? faCheck
      : status === 'dirty'
        ? faClockRotateLeft
        : status === 'saving'
          ? faSpinner
          : faCircleExclamation;
  return (
    <span
      className={`jx-research-cellSave jx-research-cellSave--${status}`}
      data-testid="research-cell-save-status"
      data-save-status={status}
      title={status === 'conflict' ? t('workbench.saveConflictHint') : undefined}
    >
      <FontAwesomeIcon icon={icon} spin={status === 'saving'} />
      {t(`workbench.saveStatus.${status}`)}
      {status === 'error' && (
        <Tooltip title={t('workbench.retrySave')}>
          <Button
            type="text"
            size="small"
            className="jx-research-cellSaveRetry"
            icon={<FontAwesomeIcon icon={faRotate} />}
            aria-label={t('workbench.retrySave')}
            onClick={onRetry}
          />
        </Tooltip>
      )}
    </span>
  );
}

// —— Agent panel ——

const ResearchAgentPanel = complex.component(({ onClose }: { onClose: () => void }) => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const messagesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }
  }, [store.documentId, store.chatMessages.length]);
  const agentBusy = store.sending || store.turnStream.streaming;
  return (
    <aside className="jx-research-agentPanel">
      <header className="jx-research-agentHead">
        <Button
          type="text"
          size="small"
          className="jx-research-agentClose"
          icon={<FontAwesomeIcon icon={faArrowLeft} />}
          aria-label={t('workbench.backToDocument')}
          data-testid="research-mobile-agent-close"
          onClick={onClose}
        />
        <span className="jx-research-agentAvatar">
          <FontAwesomeIcon icon={faCommentDots} />
        </span>
        <div>
          <strong>{t('workbench.agentTitle')}</strong>
          <span>{t('workbench.agentContext')}</span>
        </div>
      </header>
      <div ref={messagesRef} className="jx-research-agentMessages">
        {store.chatMessages.length === 0 && !agentBusy && (
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
            <MessageParts
              message={message}
              busyResearchCellChangeId={store.resolvingProposalId}
              busyResearchCellChangeRunId={store.runningProposalId}
              busyResearchCellChangeExplanationId={store.explainingAttemptId}
              researchCellChangeAttempts={store.document?.cellChangeAttempts}
              researchDocumentContentRevision={store.document?.contentRevision}
              busyResearchClarificationId={store.answeringClarificationId}
              onAnswerResearchClarification={(clarification, selections) =>
                store.answerClarification(clarification, selections)
              }
              onApplyResearchCellChange={(proposalId) => store.applyCellChangeProposal(proposalId)}
              onRejectResearchCellChange={(proposalId) =>
                store.rejectCellChangeProposal(proposalId)
              }
              onAcceptResearchCellChangeReview={(proposalId) =>
                store.acceptCellChangeReview(proposalId)
              }
              onRevertResearchCellChangeReview={(proposalId) =>
                store.revertCellChangeReview(proposalId)
              }
              onRunResearchCellChange={(proposalId) => store.runCellChangeProposal(proposalId)}
              onExplainResearchCellChangeAttempt={(attempt) =>
                store.explainCellChangeAttempt(attempt)
              }
            />
          </div>
        ))}
        {agentBusy && <AgentPending stream={store.turnStream} />}
      </div>
      <div className="jx-research-agentComposer">
        <ResearchPromptBox
          className="jx-research-agentPrompt"
          value={store.prompt}
          placeholder={
            store.hasPendingClarification
              ? t('workbench.clarification.answerBeforeContinuing')
              : t('workbench.agentPlaceholder')
          }
          autoSize={{ minRows: 3, maxRows: 10 }}
          disabled={store.hasPendingClarification || agentBusy}
          onChange={(value) => store.setPrompt(value)}
          onSubmit={() => void store.send(store.prompt)}
        />
      </div>
    </aside>
  );
}, 'ResearchAgentPanel');

function ResearchPromptBox({
  className,
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  autoSize,
  disabled,
}: {
  className: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  autoSize: { minRows: number; maxRows: number };
  disabled?: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <Input.TextArea
      className={className}
      value={value}
      autoFocus={autoFocus}
      autoSize={autoSize}
      disabled={disabled}
      variant="borderless"
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

// —— Helpers ——

function cellIcon(kind: ResearchCellKindV1) {
  switch (kind) {
    case 'markdown':
      return faFileLines;
    case 'python':
      return faCode;
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

function researchSplitterDefaults(agentWidth: number): { main: string; agent: string } {
  const viewportWidth = document.documentElement.clientWidth || 1440;
  const contentWidth = Math.max(viewportWidth - 240, agentWidth);
  const agentFraction = Math.min(agentWidth / contentWidth, 0.45);

  return {
    main: `${((1 - agentFraction) * 100).toFixed(4)}%`,
    agent: `${(agentFraction * 100).toFixed(4)}%`,
  };
}

function defaultAgentOpen(): boolean {
  return !window.matchMedia('(max-width: 920px)').matches;
}
