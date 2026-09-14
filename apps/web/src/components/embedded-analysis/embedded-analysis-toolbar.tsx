import { useEffect, useState } from 'react';
import { Button, Checkbox, Drawer, Empty, Alert, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  EmbeddedAnalysisPart,
  ResearchDataReferenceV1,
  ResearchEmbeddedHostV1,
  ResearchDataCatalogResultV1,
  ResearchDataCatalogScopeV1,
  ResearchAssetTypeV1,
  ResearchEmbeddedAnalysisV1,
  ResearchEmbeddedPageV1,
  ResearchEmbeddedRunSummaryV1,
} from '@jixie/shared';
import { makeObservable, observable, runInAction } from 'mobx';
import { BaseModel, LoaderModel, reactUtils } from '@src/lib';
import { searchResearchDataCatalog, listEmbeddedAnalyses, listEmbeddedRuns } from '@src/api/client';
import { ResearchDataCatalogPicker } from '../research-data-catalog-picker';
import { EmbeddedAnalysisInspector } from './embedded-analysis-card';
import './embedded-analysis-toolbar.css';

interface EmbeddedAnalysisToolbarProps {
  host?: ResearchEmbeddedHostV1;
  reportId?: string;
  includeReport?: boolean;
  onIncludeReportChange?(include: boolean): void;
  references: ResearchDataReferenceV1[];
  onReferencesChange(references: ResearchDataReferenceV1[]): void;
  disabled?: boolean;
}

export const EmbeddedAnalysisToolbar = reactUtils.observer(function EmbeddedAnalysisToolbar({
  host,
  reportId,
  includeReport,
  onIncludeReportChange,
  references,
  onReferencesChange,
  disabled,
}: EmbeddedAnalysisToolbarProps) {
  const { t } = useTranslation('embedded');
  const [model] = useState(() => new EmbeddedToolbarModel());
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [part, setPart] = useState<EmbeddedAnalysisPart>();
  const hostType = host?.type;
  const hostId = host?.id;
  useEffect(() => {
    model.setup({ host: hostId && hostType ? { type: hostType, id: hostId } : undefined });
    return () => model.cleanup();
  }, [model, hostType, hostId]);
  return (
    <div className="jx-embeddedToolbar" data-testid="embedded-analysis-toolbar">
      <div className="jx-embeddedToolbar-actions">
        <Button
          size="small"
          disabled={disabled || references.length >= 8}
          onClick={() => setCatalogOpen(true)}
        >
          {t('attachData')}
        </Button>
        <Button
          size="small"
          disabled={!host}
          onClick={() => {
            setHistoryOpen(true);
            void model.load();
          }}
        >
          {t('analyses')}
        </Button>
        {reportId && onIncludeReportChange && (
          <Checkbox
            checked={includeReport}
            disabled={disabled}
            onChange={(event) => onIncludeReportChange(event.target.checked)}
          >
            {t('selectedReport')}
          </Checkbox>
        )}
      </div>
      {reportId && includeReport && onIncludeReportChange && (
        <span className="jx-embeddedToolbar-note">
          {t('report')}: {reportId}
        </span>
      )}
      {references.map((reference, index) => (
        <Tag
          key={index}
          closable={!disabled}
          onClose={() => onReferencesChange(references.filter((_, position) => position !== index))}
        >
          {reference.label}
        </Tag>
      ))}
      <ResearchDataCatalogPicker
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        model={model}
        actionLabel={t('attachData')}
        intro={t('attachIntro')}
        onSelect={({ reference }) => {
          if (
            references.length < 8 &&
            !references.some(
              (item) =>
                item.method === reference.method &&
                JSON.stringify(item.arguments) === JSON.stringify(reference.arguments),
            )
          ) {
            onReferencesChange([...references, reference]);
          }
        }}
      />
      <Drawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('analyses')}
        width={460}
      >
        {model.analyses.error && (
          <Alert
            type="error"
            title={t('historyFailed')}
            action={<Button onClick={() => void model.load()}>{t('retry')}</Button>}
          />
        )}
        {model.analyses.loaded && !model.items.length && <Empty description={t('emptyAnalyses')} />}
        {model.items.map((analysis) => (
          <Button
            block
            className="jx-embeddedToolbar-historyItem"
            key={analysis.id}
            loading={model.runs.loading}
            onClick={async () => {
              try {
                const runs = await model.runs.run(analysis.id);
                const run = runs.items[0];
                setPart(
                  run
                    ? {
                        type: 'embedded_analysis',
                        title: analysis.title,
                        reference: {
                          analysisId: analysis.id,
                          versionId: run.versionId,
                          runId: run.runId,
                        },
                      }
                    : undefined,
                );
              } catch {
                /* The loader error is displayed below. */
              }
            }}
          >
            {analysis.title}
          </Button>
        ))}
        {model.analyses.result?.nextCursor && (
          <Button onClick={() => void model.load(true)}>{t('older')}</Button>
        )}
        {model.runs.error && (
          <Alert
            type="error"
            title={t('loadFailed')}
            description={model.runs.errorObject?.message}
          />
        )}
        {model.runs.loaded && !model.runs.result?.items.length && (
          <Alert type="info" title={t('draftOnly')} />
        )}
      </Drawer>
      {part && <EmbeddedAnalysisInspector part={part} open onClose={() => setPart(undefined)} />}
    </div>
  );
}, 'EmbeddedAnalysisToolbar');

// —— Data and history requests ——
class EmbeddedToolbarModel extends BaseModel<{ host?: ResearchEmbeddedHostV1 }> {
  public dataCatalogLoader = new LoaderModel<ResearchDataCatalogResultV1>();
  public analyses = new LoaderModel<ResearchEmbeddedPageV1<ResearchEmbeddedAnalysisV1>>();
  public runs = new LoaderModel<ResearchEmbeddedPageV1<ResearchEmbeddedRunSummaryV1>>();
  public items: ResearchEmbeddedAnalysisV1[] = [];
  public constructor() {
    super();
    makeObservable(this, { items: observable.ref });
  }
  public setup(params: { host?: ResearchEmbeddedHostV1 }) {
    super.setup(params);
    runInAction(() => {
      this.items = [];
    });
    this.dataCatalogLoader.setup({
      request: ({ query, assetType, scope }, signal) =>
        searchResearchDataCatalog(query, assetType, signal, scope),
    });
    this.analyses.setup({
      request: (cursor: string | undefined, signal) =>
        listEmbeddedAnalyses(params.host!, cursor, signal),
    });
    this.runs.setup({ request: (id: string, signal) => listEmbeddedRuns(id, undefined, signal) });
    this.registCleaner(() => this.dataCatalogLoader.cleanup());
    this.registCleaner(() => this.analyses.cleanup());
    this.registCleaner(() => this.runs.cleanup());
  }
  public async searchDataCatalog(
    query: string,
    assetType?: ResearchAssetTypeV1,
    scope: ResearchDataCatalogScopeV1 = 'instruments',
  ) {
    try {
      return await this.dataCatalogLoader.run({ query, assetType, scope });
    } catch {
      return undefined;
    }
  }
  public async load(older = false) {
    if (!this.setupParams?.host) {
      return;
    }
    try {
      const result = await this.analyses.run(older ? this.analyses.result?.nextCursor : undefined);
      runInAction(() => {
        this.items = older ? [...this.items, ...result.items] : result.items;
      });
    } catch {
      /* The loader error is displayed in the drawer. */
    }
  }
}
