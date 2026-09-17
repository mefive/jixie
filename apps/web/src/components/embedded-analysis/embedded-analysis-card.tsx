import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Select, Skeleton, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { EmbeddedAnalysisPart } from '@jixie/shared';
import { reactUtils } from '@src/lib';
import { ResearchOutputs } from '@src/complex/research/research-outputs';
import { EmbeddedAnalysisModel, type EmbeddedDraftForm } from './embedded-analysis-model';
import './embedded-analysis-card.css';

interface EmbeddedAnalysisCardProps {
  part: EmbeddedAnalysisPart;
}

export default reactUtils.observer(function EmbeddedAnalysisCard({
  part,
}: EmbeddedAnalysisCardProps) {
  const { t } = useTranslation('embedded');
  const model = useEmbeddedModel(part);
  const [open, setOpen] = useState(false);
  const detail = model.detail.result;
  return (
    <section className="jx-embedded-card" data-testid="embedded-analysis-card">
      <div className="jx-embedded-head">
        <strong>{part.title}</strong>
        {detail && <Tag>{t(`status.${detail.run.status}`)}</Tag>}
      </div>
      {model.detail.loading && !detail && <Skeleton active paragraph={{ rows: 2 }} />}
      {model.detail.error && (
        <Alert
          type="error"
          title={t('loadFailed')}
          description={model.detail.errorObject?.message}
          action={<Button onClick={() => void model.refresh()}>{t('retry')}</Button>}
        />
      )}
      {detail && (
        <>
          <p className="jx-embedded-note">
            {t('version', { number: detail.version.number })} ·{' '}
            {t('revision', { number: detail.run.revision })} · {detail.run.inputScope}
          </p>
          <ResearchOutputs outputs={detail.run.outputs} compact />
          {detail.run.errorCode && (
            <Alert type="error" title={t(`error.${detail.run.errorCode}`)} />
          )}
          <p className="jx-embedded-note">{t('exploratory')}</p>
        </>
      )}
      <Button size="small" onClick={() => setOpen(true)}>
        {t('inspect')}
      </Button>
      <EmbeddedAnalysisInspector part={part} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}, 'EmbeddedAnalysisCard');

// —— Details and helpers ——
const ResearchCodeEditor = lazy(() => import('@src/complex/research/research-code-editor'));
const ReadOnlyEditor = lazy(() =>
  import('@src/complex/research/research-code-editor').then((module) => ({
    default: module.ResearchReadOnlyCodeEditor,
  })),
);

export const EmbeddedAnalysisInspector = reactUtils.observer(function EmbeddedAnalysisInspector({
  part,
  open,
  onClose,
}: {
  part: EmbeddedAnalysisPart;
  open: boolean;
  onClose(): void;
}) {
  return (
    <Drawer open={open} onClose={onClose} width={860} title={part.title} destroyOnHidden>
      {open && <EmbeddedAnalysisDetail part={part} />}
    </Drawer>
  );
}, 'EmbeddedAnalysisInspector');

const EmbeddedAnalysisDetail = reactUtils.observer(function EmbeddedAnalysisDetail({
  part,
}: EmbeddedAnalysisCardProps) {
  const { t } = useTranslation('embedded');
  const navigate = useNavigate();
  const model = useEmbeddedModel(part);
  const [editing, setEditing] = useState(false);
  const detail = model.detail.result;
  useEffect(() => {
    void model.loadHistory();
  }, [model]);
  if (!detail) {
    return model.detail.error ? (
      <Alert
        type="error"
        title={t('loadFailed')}
        description={model.detail.errorObject?.message}
        action={<Button onClick={() => void model.refresh()}>{t('retry')}</Button>}
      />
    ) : (
      <Skeleton active />
    );
  }
  const { run, version, analysis } = detail;
  const busy = model.action.loading || model.detail.loading || !!analysis.activeRunId;
  return (
    <div className="jx-embedded-detail" data-testid="embedded-analysis-detail">
      <div className="jx-embedded-actions">
        <Select
          disabled={model.detail.loading || model.action.loading}
          aria-label={t('history')}
          value={model.runId}
          className="jx-embedded-history"
          onChange={(id) => {
            setEditing(false);
            void model.selectRun(id);
          }}
          options={model.historyItems.map((item) => ({
            value: item.runId,
            label: `${new Date(item.queuedAt).toLocaleString()} · ${t(`status.${item.status}`)} · ${item.runId.slice(-6)}`,
          }))}
        />
        {model.history.result?.nextCursor && (
          <Button onClick={() => void model.loadHistory(true)}>{t('older')}</Button>
        )}
        <Button disabled={model.detail.loading} onClick={() => void model.refresh()}>
          {t('refresh')}
        </Button>
      </div>
      {model.history.error && (
        <Alert
          type="error"
          title={t('historyFailed')}
          action={<Button onClick={() => void model.loadHistory()}>{t('retry')}</Button>}
        />
      )}
      {model.runId !== part.reference.runId && <Alert type="info" title={t('viewingAnotherRun')} />}
      <div className="jx-embedded-actions">
        <Tag>{t('version', { number: version.number })}</Tag>
        <Tag>{t('revision', { number: run.revision })}</Tag>
        <Tag>{t(`status.${run.status}`)}</Tag>
        <span>{new Date(run.queuedAt).toLocaleString()}</span>
      </div>
      <p>{run.inputScope}</p>
      <p className="jx-embedded-note">{version.frozenAt ? t('frozen') : t('draft')}</p>
      {run.revision !== version.revision && <Alert type="info" title={t('earlierDraft')} />}
      <ResearchOutputs outputs={run.outputs} />
      {!run.outputs.length && <Empty description={t('noOutput')} />}
      {run.errorCode && (
        <Alert
          type="error"
          title={t(`error.${run.errorCode}`)}
          description={<pre className="jx-embedded-json">{run.error}</pre>}
        />
      )}
      <div className="jx-embedded-actions">
        <Button disabled={busy} onClick={() => setEditing(!editing)}>
          {version.frozenAt ? t('derive') : t('edit')}
        </Button>
        <Button
          disabled={busy}
          loading={model.action.loading}
          onClick={() => void model.act({ type: 'run' })}
        >
          {t('runCurrent')}
        </Button>
        {['queued', 'running'].includes(run.status) && (
          <Button onClick={() => void model.act({ type: 'cancel' })}>{t('cancel')}</Button>
        )}
        <Button
          type="primary"
          disabled={run.status !== 'success' || model.action.loading}
          onClick={async () => {
            const result = await model.act({ type: 'continue' });
            if (result?.documentId) {
              navigate(`/research?document=${encodeURIComponent(result.documentId)}`);
            }
          }}
        >
          {run.researchDocumentId ? t('openResearch') : t('continueResearch')}
        </Button>
      </div>
      <p className="jx-embedded-note">{t('runCurrentNote')}</p>
      {model.action.error && (
        <Alert
          type="error"
          title={t('actionFailed')}
          description={model.action.errorObject?.message}
        />
      )}
      {editing && (
        <EmbeddedDraftEditor
          key={`${version.id}:${version.revision}`}
          model={model}
          onSubmitted={() => setEditing(false)}
        />
      )}
      <details>
        <summary>{t('code')}</summary>
        <Suspense fallback={<Skeleton active />}>
          <ReadOnlyEditor
            executionId={run.runId}
            cellId={version.id}
            value={run.source}
            language="python"
          />
        </Suspense>
        <pre className="jx-embedded-json">{JSON.stringify(run.parameters, null, 2)}</pre>
      </details>
      <details>
        <summary>{t('source')}</summary>
        <p>
          {run.context.name} · {t('savedHost')}
        </p>
        <p>{run.context.report ? `${t('report')}: ${run.context.report.id}` : t('noReport')}</p>
        {run.context.report && (
          <>
            <p>
              {t('reportFingerprint')}: <code>{run.context.report.contentHash}</code>
            </p>
            <Button
              size="small"
              onClick={() =>
                navigate(
                  run.context.host.type === 'factor'
                    ? `/factors?factor=${encodeURIComponent(run.context.host.id)}&report=${encodeURIComponent(run.context.report!.id)}`
                    : `/strategy?id=${encodeURIComponent(run.context.host.id)}&report=${encodeURIComponent(run.context.report!.id)}`,
                )
              }
            >
              {t('openReport')}
            </Button>
          </>
        )}
        <p>
          {t('sourceTime')}: {run.context.capturedAt}
        </p>
        <code>{run.context.codeHash}</code>
        <pre className="jx-embedded-json">{run.context.code}</pre>
      </details>
      <details open>
        <summary>{t('usedInputs')}</summary>
        {!run.inputs.length && <p>{t('noInputs')}</p>}
        {run.inputs.map((input) => (
          <section className="jx-embedded-input" key={input.id}>
            <strong>{input.method.replace(/^research_/, '')}</strong>
            <p>
              {input.rowCount == null ? t('structuredInput') : t('rows', { count: input.rowCount })}{' '}
              · {input.capturedAt ?? input.requestedAt}
            </p>
            <pre className="jx-embedded-json">{JSON.stringify(input.arguments, null, 2)}</pre>
            {Object.keys(input.metadata).length > 0 && (
              <details>
                <summary>{t('diagnostics')}</summary>
                <pre className="jx-embedded-json">{JSON.stringify(input.metadata, null, 2)}</pre>
              </details>
            )}
            {input.error && <Alert type="warning" title={input.error} />}
            <details>
              <summary>{t('inputFingerprint')}</summary>
              <code>{input.sha256 ?? t('notCaptured')}</code>
            </details>
            <Button
              size="small"
              disabled={!input.sha256 || model.action.loading}
              onClick={() => void model.act({ type: 'input', inputId: input.id })}
            >
              {t('viewInput')}
            </Button>
          </section>
        ))}
      </details>
      {model.action.result?.input && (
        <details open>
          <summary>{t('inputPreview')}</summary>
          <pre className="jx-embedded-json">
            {JSON.stringify(model.action.result.input, null, 2).slice(0, 20_000)}
          </pre>
          <p className="jx-embedded-note">{t('previewLimit')}</p>
        </details>
      )}
      <details>
        <summary>{t('limits')}</summary>
        <p>
          {t('budget', {
            seconds: run.limits.executionMilliseconds / 1000,
            requests: run.limits.sdkRequests,
            mib: run.limits.inputBytes / 1024 / 1024,
          })}
        </p>
        <p>{t('exploratory')}</p>
        <pre className="jx-embedded-json">{JSON.stringify(run.environment, null, 2)}</pre>
        <code>{run.sourceHash}</code>
      </details>
    </div>
  );
}, 'EmbeddedAnalysisDetail');

const EmbeddedDraftEditor = reactUtils.observer(function EmbeddedDraftEditor({
  model,
  onSubmitted,
}: {
  model: EmbeddedAnalysisModel;
  onSubmitted(): void;
}) {
  const { t } = useTranslation('embedded');
  const { version, run } = model.detail.result;
  const [form, setForm] = useState<EmbeddedDraftForm>({
    source: run.source,
    parameters: JSON.stringify(run.parameters, null, 2),
    inputScope: run.inputScope,
  });
  const submit = async () => {
    if (await model.act({ type: 'edit', draft: form })) {
      onSubmitted();
    }
  };
  return (
    <section className="jx-embedded-editor" data-testid="embedded-draft-editor">
      <p>{version.frozenAt ? t('deriveNote') : t('editNote')}</p>
      <label>
        {t('scope')}
        <Input.TextArea
          value={form.inputScope}
          maxLength={2000}
          onChange={(event) => setForm({ ...form, inputScope: event.target.value })}
        />
      </label>
      <Suspense fallback={<Skeleton active />}>
        <ResearchCodeEditor
          documentId={`embedded-${version.analysisId}`}
          cellId={version.id}
          cells={[
            {
              id: 'parameters',
              source: `import json\nparameters = json.loads(${JSON.stringify(form.parameters)})`,
            },
            { id: version.id, source: form.source },
          ]}
          value={form.source}
          language="python"
          onChange={(source) => setForm({ ...form, source })}
          onRun={() => void submit()}
          onBlur={() => {}}
        />
      </Suspense>
      <label>
        {t('parameters')}
        <Input.TextArea
          value={form.parameters}
          onChange={(event) => setForm({ ...form, parameters: event.target.value })}
          autoSize={{ minRows: 2, maxRows: 8 }}
        />
      </label>
      <Button type="primary" loading={model.action.loading} onClick={() => void submit()}>
        {version.frozenAt ? t('deriveRun') : t('saveRun')}
      </Button>
    </section>
  );
}, 'EmbeddedDraftEditor');

function useEmbeddedModel(part: EmbeddedAnalysisPart) {
  const [model] = useState(() => new EmbeddedAnalysisModel());
  const { analysisId, versionId, runId } = part.reference;
  const title = part.title;
  useEffect(() => {
    model.setup({
      part: { type: 'embedded_analysis', title, reference: { analysisId, versionId, runId } },
    });
    return () => model.cleanup();
  }, [model, analysisId, versionId, runId, title]);
  return model;
}
