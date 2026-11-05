import { useEffect, useState } from 'react';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Descriptions, Drawer, Empty, Table, Tag } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDatabase } from '@fortawesome/free-solid-svg-icons';
import type { IssueHandlingCounts, IngestionIssueList } from '@jixie/shared/api/ingestion';
import { maintenanceStore } from '@src/store';
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
            <p className="jx-dataHealth-note">
              {t('dataHealth.candidateDetails', {
                runId: status.candidate.runId,
                targetDate: status.candidate.targetDate,
              })}
            </p>
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
              rowKey="id"
              size="small"
              loading={loader.loading}
              dataSource={loader.result?.items ?? []}
              scroll={{ x: 660 }}
              pagination={{
                current: page,
                pageSize: 20,
                total: loader.result?.total ?? 0,
                showSizeChanger: false,
                onChange: setPage,
              }}
              columns={[
                {
                  title: t('dataHealth.severity'),
                  dataIndex: 'severity',
                  render: (severity: string) => (
                    <Tag color={severity === 'error' ? 'error' : 'warning'}>
                      {t(`dataHealth.severities.${severity}`)}
                    </Tag>
                  ),
                },
                {
                  title: t('dataHealth.problem'),
                  render: (_value, item) => (
                    <div>
                      <div>
                        {item.dataset ?? t('dataHealth.runLevel')} · {item.scope ?? item.targetDate}
                      </div>
                      <div className="jx-dataHealth-note">{item.businessKey ?? item.period}</div>
                      <div>{item.message || item.reasonCode}</div>
                    </div>
                  ),
                },
                {
                  title: t('dataHealth.handling'),
                  render: (_value, item) => (
                    <div>
                      <Tag
                        color={
                          item.status === 'pending'
                            ? 'warning'
                            : item.status === 'review'
                              ? 'default'
                              : 'success'
                        }
                      >
                        {t(`dataHealth.handlingStates.${item.status}`)}
                      </Tag>
                      {item.verification === 'changed' || item.verification === 'unknown' ? (
                        <div>{t(`dataHealth.verification.${item.verification}`)}</div>
                      ) : null}
                    </div>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (item) => (
                  <div className="jx-dataHealth-expanded">
                    <div>
                      {t('dataHealth.issueId')}: {item.id}
                    </div>
                    <div>
                      {t('dataHealth.run')}: {item.runId}
                    </div>
                    <div>{item.handlingReason ?? t('dataHealth.notHandled')}</div>
                    {item.resolvedAt && (
                      <div>
                        {t('dataHealth.handledAt')}: {new Date(item.resolvedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                ),
              }}
            />
          )}
        </div>
      </Drawer>
    </>
  );
});

// —— 子组件／帮助函数 / Helpers ——

type IssueRow = IngestionIssueList['items'][number];

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
