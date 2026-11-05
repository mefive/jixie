import { useEffect, useState } from 'react';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Grid,
  Modal,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDatabase } from '@fortawesome/free-solid-svg-icons';
import type { IssueHandlingCounts, IngestionIssueList } from '@jixie/shared/api/ingestion';
import { maintenanceStore } from '@src/store';
import { authStore } from '@src/store/auth-store';
import './data-health-status.css';

/**
 * 区分采集执行结果和当前处理进度；离散来源问题不阻断使用。
 *
 * Separate historical ingestion outcomes from current handling without blocking product use.
 */
export const DataHealthStatus = observer(() => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const wideIssueTable = Grid.useBreakpoint().sm;
  const status = maintenanceStore.status;
  const health = status?.health;
  const latest = health?.latestRun;
  const loader = maintenanceStore.issuesLoader;
  const pending = health?.handling.pending;
  const candidatePhase = status?.candidate?.phase;
  const candidateLabels: Record<string, string> = {
    running: 'updating',
    awaiting_repair: 'candidateRepair',
    repairing: 'candidateRepairing',
    awaiting_publish: 'candidateReview',
    publishing: 'candidatePublishing',
    interrupted: 'candidateInterrupted',
  };
  const candidateLabel = candidatePhase ? candidateLabels[candidatePhase] : undefined;
  const label =
    candidateLabel ??
    (status?.running || candidatePhase === 'running'
      ? 'updating'
      : ['failed', 'interrupted'].includes(latest?.status)
        ? 'failed'
        : pending?.error
          ? 'pendingErrors'
          : pending?.warning
            ? 'pendingWarnings'
            : health?.unknownValidity
              ? 'review'
              : latest
                ? 'updated'
                : 'uninitialized');
  const color =
    label === 'failed' || label === 'candidateInterrupted'
      ? 'error'
      : label === 'pendingErrors' || label === 'pendingWarnings'
        ? 'warning'
        : label === 'updating' ||
            label === 'candidateRepair' ||
            label === 'candidateReview' ||
            label === 'candidateRepairing' ||
            label === 'candidatePublishing'
          ? 'processing'
          : label === 'review'
            ? 'default'
            : 'success';

  useEffect(() => {
    if (!open) {
      return;
    }
    void maintenanceStore.loadIssues((page - 1) * 20);

    return () => maintenanceStore.issuesLoader.abort();
  }, [open, page]);

  return (
    <>
      <Button
        className="jx-dataHealth-trigger"
        type="text"
        onClick={() => setOpen(true)}
        aria-label={t('dataHealth.open')}
      >
        <FontAwesomeIcon icon={faDatabase} />
        <Tag color={color}>
          {t(`dataHealth.labels.${label}`, {
            count: pending?.error || pending?.warning || health?.unknownValidity || 0,
          })}
        </Tag>
      </Button>
      <Drawer title={t('dataHealth.title')} open={open} onClose={() => setOpen(false)} size="large">
        <div className="jx-dataHealth-content">
          <p className="jx-dataHealth-note">{t('dataHealth.description')}</p>
          {status?.candidate && (
            <div className="jx-dataHealth-candidate">
              <p className="jx-dataHealth-note">
                {t('dataHealth.candidateDetails', {
                  runId: status.candidate.runId,
                  targetDate: status.candidate.targetDate,
                })}
              </p>
              <CandidateAcceptance />
            </div>
          )}
          {latest ? (
            <Descriptions
              size="small"
              column={1}
              bordered
              items={[
                { key: 'run', label: t('dataHealth.run'), children: latest.id },
                { key: 'target', label: t('dataHealth.target'), children: latest.targetDate },
                {
                  key: 'status',
                  label: t('dataHealth.execution'),
                  children: t(`dataHealth.runStates.${latest.status}`, {
                    defaultValue: latest.status,
                  }),
                },
                {
                  key: 'time',
                  label: t('dataHealth.finishedAt'),
                  children: latest.finishedAt
                    ? new Date(latest.finishedAt).toLocaleString()
                    : t('dataHealth.inProgress'),
                },
                ...(latest.execution
                  ? [
                      {
                        key: 'counts',
                        label: t('dataHealth.batchCounts'),
                        children: t('dataHealth.batchSummary', latest.execution),
                      },
                    ]
                  : []),
                ...(latest.execution?.issues != null && latest.execution?.warnings != null
                  ? [
                      {
                        key: 'diagnostics',
                        label: t('dataHealth.originalDiagnostics'),
                        children: t('dataHealth.diagnosticSummary', latest.execution),
                      },
                    ]
                  : []),
                {
                  key: 'handling',
                  label: t('dataHealth.latestHandling'),
                  children: handlingText(latest.handling, t),
                },
              ]}
            />
          ) : (
            <Empty description={t('dataHealth.labels.uninitialized')} />
          )}
          {health && (
            <section className="jx-dataHealth-summary">
              <h3>{t('dataHealth.allRuns')}</h3>
              <p>{handlingText(health.handling, t)}</p>
              {health.coveredHistorical > 0 && (
                <p className="jx-dataHealth-note">
                  {t('dataHealth.coveredHistorical', { count: health.coveredHistorical })}
                </p>
              )}
              {health.unknownValidity > 0 && (
                <p className="jx-dataHealth-note">
                  {t('dataHealth.needsReview', { count: health.unknownValidity })}
                </p>
              )}
              {health.missingResolutionRecords > 0 && (
                <p className="jx-dataHealth-note">
                  {t('dataHealth.missingResolutionRecords', {
                    count: health.missingResolutionRecords,
                  })}
                </p>
              )}
            </section>
          )}
          <div className="jx-dataHealth-actions">
            <h3>{t('dataHealth.issueDetails')}</h3>
            <Button
              size="small"
              onClick={() => void maintenanceStore.loadIssues((page - 1) * 20)}
              loading={loader.loading}
            >
              {t('dataHealth.refresh')}
            </Button>
          </div>
          {loader.error ? (
            <Alert type="error" showIcon title={t('dataHealth.loadFailed')} />
          ) : (
            <Table<IssueRow>
              className="jx-dataHealth-issues"
              rowKey="id"
              size="small"
              loading={loader.loading}
              dataSource={loader.result?.items ?? []}
              tableLayout="fixed"
              pagination={{
                current: page,
                pageSize: 20,
                total: loader.result?.total ?? 0,
                showSizeChanger: false,
                onChange: setPage,
              }}
              columns={[
                ...(wideIssueTable
                  ? [
                      {
                        title: t('dataHealth.severity'),
                        key: 'severity',
                        width: 80,
                        render: (_value: unknown, item: IssueRow) => <IssueSeverity item={item} />,
                      },
                    ]
                  : []),
                {
                  title: t('dataHealth.problem'),
                  key: 'problem',
                  render: (_value, item) => <IssueSummary item={item} showTags={!wideIssueTable} />,
                },
                ...(wideIssueTable
                  ? [
                      {
                        title: t('dataHealth.handling'),
                        key: 'handling',
                        width: 132,
                        render: (_value: unknown, item: IssueRow) => <IssueHandling item={item} />,
                      },
                    ]
                  : []),
              ]}
              expandable={{
                columnWidth: 40,
                expandedRowRender: (item) => <IssueDetails item={item} />,
              }}
            />
          )}
        </div>
      </Drawer>
    </>
  );
});

// —— 子组件／帮助函数 / Helpers ——

/**
 * 接收前加载候选版本，确认后提交同一版本摘要。
 *
 * Load the candidate version before confirmation and submit that same version on acceptance.
 */
const CandidateAcceptance = observer(() => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [reviewedRunId, setReviewedRunId] = useState<string | null>(null);
  const canPublish = Boolean(authStore.user?.capabilities?.publishIngestion);
  const candidate = maintenanceStore.status?.candidate;
  const loader = maintenanceStore.candidateLoader;
  const publishing = maintenanceStore.publishLoader;
  const review = loader.result;
  const ready = Boolean(
    candidate?.phase === 'awaiting_publish' &&
    review?.phase === 'awaiting_publish' &&
    review.pending === 0 &&
    review.runId === reviewedRunId &&
    candidate.runId === reviewedRunId &&
    review.candidateVersion &&
    loader.loaded,
  );

  useEffect(() => {
    if (!canPublish) {
      setReviewedRunId(null);
      return;
    }
    if (!reviewedRunId) {
      return;
    }
    publishing.reset();
    void maintenanceStore.loadCandidate(reviewedRunId);

    return () => loader.abort();
  }, [reviewedRunId, canPublish, loader, publishing]);

  if (!canPublish || !candidate) {
    return null;
  }

  return (
    <>
      <Tooltip
        title={
          candidate.phase === 'awaiting_publish' ? undefined : t('dataHealth.candidateNotReady')
        }
      >
        <Button
          type="primary"
          disabled={candidate.phase !== 'awaiting_publish' || publishing.loading}
          onClick={() => {
            loader.abort();
            loader.reset();
            setReviewedRunId(candidate.runId);
          }}
        >
          {t('dataHealth.acceptCandidate')}
        </Button>
      </Tooltip>
      <Modal
        title={t('dataHealth.acceptTitle')}
        open={Boolean(reviewedRunId)}
        okText={t('dataHealth.acceptAndPublish')}
        cancelText={t('dataHealth.cancel')}
        confirmLoading={publishing.loading}
        okButtonProps={{ disabled: !ready || publishing.loading }}
        cancelButtonProps={{ disabled: publishing.loading }}
        closable={!publishing.loading}
        maskClosable={!publishing.loading}
        onCancel={() => setReviewedRunId(null)}
        onOk={async () => {
          if (!ready || publishing.loading) {
            return;
          }
          const accepted = await maintenanceStore.publishCandidate(
            review.runId,
            review.candidateVersion,
          );
          if (accepted) {
            setReviewedRunId(null);
            void message.success(t('dataHealth.accepted'));
          }
        }}
      >
        <div className="jx-dataHealth-review">
          <p>{t('dataHealth.acceptDescription')}</p>
          {loader.loading && <Spin />}
          {loader.error && (
            <Alert
              type="error"
              showIcon
              title={loader.errorObject?.message ?? t('dataHealth.candidateLoadFailed')}
            />
          )}
          {review?.runId === reviewedRunId && !loader.loading && !loader.error && (
            <Descriptions
              size="small"
              bordered
              column={1}
              items={[
                { key: 'run', label: t('dataHealth.run'), children: review.runId },
                { key: 'target', label: t('dataHealth.target'), children: review.targetDate },
                {
                  key: 'status',
                  label: t('dataHealth.execution'),
                  children: t(`dataHealth.runStates.${review.status}`, {
                    defaultValue: review.status,
                  }),
                },
                ...(review.execution
                  ? [
                      {
                        key: 'batches',
                        label: t('dataHealth.batchCounts'),
                        children: t('dataHealth.batchSummary', review.execution),
                      },
                    ]
                  : []),
                {
                  key: 'pending',
                  label: t('dataHealth.candidatePending'),
                  children: review.pending,
                },
              ]}
            />
          )}
          {review && !ready && !loader.loading && !loader.error && !publishing.loading && (
            <Alert type="warning" showIcon title={t('dataHealth.candidateChanged')} />
          )}
          {publishing.error && (
            <Alert
              type="error"
              showIcon
              title={publishing.errorObject?.message ?? t('dataHealth.acceptFailed')}
            />
          )}
          {publishing.loading && (
            <p className="jx-dataHealth-note">{t('dataHealth.publishingHint')}</p>
          )}
        </div>
      </Modal>
    </>
  );
});

type IssueRow = IngestionIssueList['items'][number];

function IssueSeverity({ item }: { item: IssueRow }) {
  const { t } = useTranslation();

  return (
    <Tag color={item.severity === 'error' ? 'error' : 'warning'}>
      {t(`dataHealth.severities.${item.severity}`)}
    </Tag>
  );
}

function IssueHandling({ item }: { item: IssueRow }) {
  const { t } = useTranslation();
  const color =
    item.status === 'pending' ? 'warning' : item.status === 'review' ? 'default' : 'success';

  return (
    <div>
      <Tag color={color}>{t(`dataHealth.handlingStates.${item.status}`)}</Tag>
      {item.verification === 'changed' || item.verification === 'unknown' ? (
        <div className="jx-dataHealth-note">
          {t(`dataHealth.verification.${item.verification}`)}
        </div>
      ) : null}
    </div>
  );
}

function IssueSummary({ item, showTags }: { item: IssueRow; showTags: boolean }) {
  const { t } = useTranslation();
  const dataset = item.dataset
    ? t(`dataHealth.issueDatasets.${item.dataset}`, { defaultValue: item.dataset })
    : t('dataHealth.runLevel');

  return (
    <div className="jx-dataHealth-issueSummary">
      {showTags && (
        <div className="jx-dataHealth-issueTags">
          <IssueSeverity item={item} />
          <IssueHandling item={item} />
        </div>
      )}
      <div>
        {t(`dataHealth.issueReasons.${item.reasonCode}`, {
          defaultValue: t('dataHealth.issueDiagnostic'),
        })}
      </div>
      <div className="jx-dataHealth-note">{issueContext(item, dataset)}</div>
    </div>
  );
}

function IssueDetails({ item }: { item: IssueRow }) {
  const { t } = useTranslation();
  const fields = [
    { key: 'issueId', value: item.id },
    { key: 'run', value: item.runId },
    { key: 'issueBatch', value: [item.scope, item.period].filter(Boolean).join(' · ') },
    { key: 'issueBusinessKey', value: item.businessKey },
    { key: 'issueDiagnostic', value: item.message || item.reasonCode },
  ];

  return (
    <div className="jx-dataHealth-expanded">
      <Descriptions
        column={1}
        size="small"
        items={fields
          .filter(({ value }) => value)
          .map(({ key, value }) => ({
            key,
            label: t(`dataHealth.${key}`),
            children: (
              <Typography.Text className="jx-dataHealth-technicalValue" copyable={{ text: value }}>
                {value}
              </Typography.Text>
            ),
          }))}
      />
      <div>{item.handlingReason ?? t('dataHealth.notHandled')}</div>
      {item.resolvedAt && (
        <div>
          {t('dataHealth.handledAt')} · {new Date(item.resolvedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

/**
 * 旧业务键可能是重复序列化的 JSON，摘要只读取其中可识别的证券与日期。
 *
 * Legacy keys may be JSON-encoded twice; use only recognized security and date fields in summaries.
 */
function issueContext(item: IssueRow, dataset: string): string {
  let fields: Record<string, unknown> = {};
  if (item.businessKey) {
    try {
      const key: unknown = JSON.parse(item.businessKey);
      const decoded: unknown = typeof key === 'string' ? JSON.parse(key) : key;
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        fields = decoded as Record<string, unknown>;
      }
    } catch {
      // 旧键原文仍在详情中。 / The legacy key remains available in the details.
    }
  }

  const scope = typeof fields.tsCode === 'string' && fields.tsCode ? fields.tsCode : item.scope;
  const date =
    formatIssuePeriod(fields.tradeDate) ??
    formatIssuePeriod(fields.endDate) ??
    formatIssuePeriod(item.period) ??
    (!scope ? formatIssuePeriod(item.targetDate) : undefined);

  return [scope, date, dataset].filter(Boolean).join(' · ');
}

function formatIssuePeriod(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  }
  if (/^\d{6}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4)}`;
  }

  return /^\d{4}$/.test(value) ? value : undefined;
}

function handlingText(
  counts: IssueHandlingCounts,
  translate: (key: string, values: Record<string, number>) => string,
): string {
  return translate('dataHealth.handlingSummary', {
    errors: counts.pending.error,
    warnings: counts.pending.warning,
    resolved: counts.resolved.error + counts.resolved.warning,
    accepted: counts.accepted.error + counts.accepted.warning,
  });
}
