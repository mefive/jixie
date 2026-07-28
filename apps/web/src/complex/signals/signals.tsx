import { Alert, Button, Empty, Skeleton, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  faArrowsRotate,
  faBell,
  faCircleCheck,
  faEnvelope,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { SignalItem, SignalRun, SignalTodayEntry } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { LogView } from '@src/components/log-view';
import { complex } from './complex';
import './signals.css';

export const Signals = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('signals');
  const selected = store.selected;

  return (
    <main className="jx-signals">
      <header className="jx-signals-header">
        <div>
          <h1 className="jx-signals-title">{t('title')}</h1>
          <p className="jx-signals-subtitle">{t('subtitle')}</p>
        </div>
        <Button
          icon={<FontAwesomeIcon icon={faArrowsRotate} />}
          loading={store.todayLoader.loading}
          onClick={() => void store.refresh()}
        >
          {t('refresh')}
        </Button>
      </header>

      {store.error && (
        <Alert className="jx-signals-alert" type="error" showIcon message={store.error} />
      )}

      {store.todayLoader.loading && store.entries.length === 0 ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : store.entries.length === 0 ? (
        <Empty
          className="jx-signals-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('noDeployments')}
        />
      ) : (
        <div className="jx-signals-layout">
          <aside className="jx-signals-sidebar">
            {store.entries.map((entry) => (
              <DeploymentCard
                key={entry.deployment.id}
                entry={entry}
                active={entry.deployment.id === selected?.deployment.id}
                onClick={() => store.selectDeployment(entry.deployment.id)}
              />
            ))}
          </aside>

          {selected && (
            <section className="jx-signals-content">
              <SignalHeader entry={selected} />
              <div className="jx-signals-actions">
                <Button
                  type="primary"
                  icon={<FontAwesomeIcon icon={faArrowsRotate} />}
                  loading={store.runningDeploymentId === selected.deployment.id}
                  disabled={
                    !!store.runningDeploymentId &&
                    store.runningDeploymentId !== selected.deployment.id
                  }
                  onClick={() => void store.generate(selected.deployment.id)}
                >
                  {t('generate')}
                </Button>
                <span className="jx-signals-actionHint">{t('generateHint')}</span>
              </div>

              {store.logLines.length > 0 && (
                <div className="jx-signals-log">
                  <LogView lines={store.logLines} emptyText={t('logEmpty')} />
                </div>
              )}

              <SignalResult run={selected.run} />
              <History runs={store.historyLoader.result ?? []} />
            </section>
          )}
        </div>
      )}
    </main>
  );
}, 'Signals');

// —— Subcomponents / helpers ——

function DeploymentCard({
  entry,
  active,
  onClick,
}: {
  entry: SignalTodayEntry;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('signals');
  const run = entry.run;
  return (
    <button
      type="button"
      className={classNames('jx-signals-deploymentCard', {
        'jx-signals-deploymentCard--active': active,
      })}
      onClick={onClick}
    >
      <span className="jx-signals-deploymentName">{entry.deployment.strategyName}</span>
      <span className="jx-signals-deploymentMeta">
        {run ? `${formatDate(run.tradeDate)} · ${t(`status.${run.status}`)}` : t('neverRun')}
      </span>
    </button>
  );
}

function SignalHeader({ entry }: { entry: SignalTodayEntry }) {
  const { t } = useTranslation('signals');
  return (
    <div className="jx-signals-signalHeader">
      <div>
        <h2 className="jx-signals-strategyName">{entry.deployment.strategyName}</h2>
        <p className="jx-signals-version">
          {t('version', {
            hash: entry.deployment.codeHash.slice(0, 8),
            date: formatDate(entry.deployment.deployedAt.slice(0, 10).replaceAll('-', '')),
          })}
        </p>
      </div>
      <Tag color="green">{t('active')}</Tag>
    </div>
  );
}

function SignalResult({ run }: { run: SignalRun | null }) {
  const { t } = useTranslation('signals');
  if (!run) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noRuns')} />;
  }
  if (run.status === 'running') {
    return <Skeleton active paragraph={{ rows: 5 }} />;
  }
  if (run.status === 'error' || run.status === 'stale') {
    return (
      <Alert
        type="error"
        showIcon
        message={t(`status.${run.status}`)}
        description={run.error || t('interrupted')}
      />
    );
  }

  const signals = run.signals ?? [];
  return (
    <>
      <div className="jx-signals-runMeta">
        <div className="jx-signals-metric">
          <span className="jx-signals-metricLabel">{t('signalDate')}</span>
          <strong className="jx-signals-metricValue">{formatDate(run.tradeDate)}</strong>
        </div>
        <div className="jx-signals-metric">
          <span className="jx-signals-metricLabel">{t('execDate')}</span>
          <strong className="jx-signals-metricValue">{formatDate(run.execDate)}</strong>
        </div>
        <div className="jx-signals-metric">
          <span className="jx-signals-metricLabel">{t('modelEquity')}</span>
          <strong className="jx-signals-metricValue">{formatMoney(run.modelEquity)}</strong>
        </div>
        <NotificationState run={run} />
      </div>

      {signals.length === 0 ? (
        <div className="jx-signals-noAction">
          <FontAwesomeIcon icon={faCircleCheck} />
          <div>
            <strong className="jx-signals-noActionTitle">{t('noAction')}</strong>
            <p className="jx-signals-noActionText">{t('noActionHint')}</p>
          </div>
        </div>
      ) : (
        <Table<SignalItem>
          className="jx-signals-table"
          rowKey={(signal) => `${signal.code}-${signal.source}`}
          columns={signalColumns(t)}
          dataSource={signals}
          pagination={false}
          size="small"
        />
      )}
      <p className="jx-signals-referenceNote">{t('referenceNote')}</p>
    </>
  );
}

function NotificationState({ run }: { run: SignalRun }) {
  const { t } = useTranslation('signals');
  return (
    <div className="jx-signals-metric">
      <span className="jx-signals-metricLabel">{t('notification')}</span>
      <strong className="jx-signals-metricValue">
        <FontAwesomeIcon
          icon={
            run.notificationError ? faTriangleExclamation : run.notifiedAt ? faEnvelope : faBell
          }
        />{' '}
        {run.notificationError
          ? t('notificationFailed')
          : run.notifiedAt
            ? t('notificationSent')
            : t('notificationSkipped')}
      </strong>
    </div>
  );
}

function History({ runs }: { runs: SignalRun[] }) {
  const { t } = useTranslation('signals');
  if (runs.length === 0) {
    return null;
  }
  return (
    <section className="jx-signals-history">
      <h3 className="jx-signals-historyTitle">{t('history')}</h3>
      <div className="jx-signals-historyList">
        {runs.map((run) => (
          <div className="jx-signals-historyRow" key={run.id}>
            <span>{formatDate(run.tradeDate)}</span>
            <Tag
              color={run.status === 'done' ? 'green' : run.status === 'running' ? 'blue' : 'red'}
            >
              {t(`status.${run.status}`)}
            </Tag>
            <span>{t('instructionCount', { count: run.signals?.length ?? 0 })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function signalColumns(t: (key: string, options?: any) => string): ColumnsType<SignalItem> {
  return [
    {
      title: t('instrument'),
      key: 'instrument',
      render: (_, signal) => (
        <div>
          <strong>{signal.name}</strong>
          <span className="jx-signals-code">{signal.code}</span>
        </div>
      ),
    },
    {
      title: t('asset'),
      dataIndex: 'assetType',
      render: (assetType: SignalItem['assetType']) => t(`assetType.${assetType}`),
    },
    {
      title: t('action'),
      dataIndex: 'action',
      render: (action: SignalItem['action']) => (
        <span className={action === 'buy' ? 'text-up' : 'text-down'}>
          {t(`actionType.${action}`)}
        </span>
      ),
    },
    {
      title: t('shares'),
      dataIndex: 'shares',
      align: 'right',
      render: (shares: number) => shares.toLocaleString(),
    },
    {
      title: t('refPrice'),
      dataIndex: 'refPrice',
      align: 'right',
      render: (price: number) => `¥${price.toFixed(2)}`,
    },
    {
      title: t('refAmount'),
      dataIndex: 'refAmount',
      align: 'right',
      render: (amount: number) => formatMoney(amount),
    },
  ];
}

function formatDate(date?: string | null): string {
  if (!date) {
    return '—';
  }
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function formatMoney(value?: number | null): string {
  return value == null ? '—' : `¥${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
