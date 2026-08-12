import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  faArrowsRotate,
  faBell,
  faCircleCheck,
  faEnvelope,
  faPenToSquare,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type {
  ActualExecutionUpdate,
  FactorDependency,
  FactorInputSummary,
  SignalExecution,
  SignalItem,
  SignalRun,
  SignalTodayEntry,
  StrategyExecutionOverview,
} from '@jixie/shared';
import { lazy, Suspense, useState } from 'react';
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
                  <LogView
                    lines={store.logLines}
                    emptyText={
                      store.queuePosition
                        ? t('queuePosition', { position: store.queuePosition })
                        : t('logEmpty')
                    }
                  />
                </div>
              )}

              <ExecutionOverview
                overview={store.overviewLoader.result}
                loading={store.overviewLoader.loading}
              />
              <SignalResult
                run={store.selectedRun}
                savingExecutionId={store.savingExecutionId}
                onSave={(executionId, input) => void store.saveExecution(executionId, input)}
              />
              <History
                runs={store.historyLoader.result ?? []}
                selectedRunId={store.selectedRun?.id ?? ''}
                onSelect={(runId) => store.selectRun(runId)}
              />
            </section>
          )}
        </div>
      )}
    </main>
  );
}, 'Signals');

// —— Subcomponents / helpers ——

const ExecutionChart = lazy(() => import('./execution-chart'));

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

function ExecutionOverview({
  overview,
  loading,
}: {
  overview?: StrategyExecutionOverview;
  loading: boolean;
}) {
  const { t } = useTranslation('signals');
  if (loading && !overview) {
    return <Skeleton active paragraph={{ rows: 3 }} />;
  }
  if (!overview || overview.model.length === 0) {
    return null;
  }

  const model = overview.model.at(-1);
  const simulation = overview.simulation.at(-1);
  const actual = overview.actual.at(-1);
  return (
    <section className="jx-signals-overview">
      <div className="jx-signals-sectionHeading">
        <div>
          <h3 className="jx-signals-sectionTitle">{t('account.title')}</h3>
          <p className="jx-signals-sectionHint">{t('account.hint')}</p>
        </div>
      </div>
      <div className="jx-signals-accountMetrics">
        <AccountMetric label={t('account.model')} value={formatMoney(model?.equity)} />
        <AccountMetric
          label={t('account.simulation')}
          value={formatMoney(simulation?.equity)}
          delta={relativeDelta(simulation?.equity, model?.equity)}
        />
        <AccountMetric
          label={t('account.actual')}
          value={formatMoney(actual?.equity)}
          delta={relativeDelta(actual?.equity, simulation?.equity)}
        />
        <AccountMetric
          label={t('account.executionRate')}
          value={formatPercent(overview.execution.executionRate)}
          note={
            overview.execution.averagePriceDeviationBps == null
              ? t('account.noDeviation')
              : t('account.deviation', {
                  value: overview.execution.averagePriceDeviationBps.toFixed(1),
                })
          }
        />
      </div>
      <Suspense fallback={<Skeleton active paragraph={{ rows: 4 }} />}>
        <ExecutionChart overview={overview} />
      </Suspense>
    </section>
  );
}

function AccountMetric({
  label,
  value,
  delta,
  note,
}: {
  label: string;
  value: string;
  delta?: number | null;
  note?: string;
}) {
  const { t } = useTranslation('signals');
  return (
    <div className="jx-signals-accountMetric">
      <span className="jx-signals-metricLabel">{label}</span>
      <strong className="jx-signals-accountValue">{value}</strong>
      {delta != null ? (
        <span
          className={classNames('jx-signals-accountDelta', {
            'jx-signals-accountDelta--positive': delta > 0,
            'jx-signals-accountDelta--negative': delta < 0,
          })}
        >
          {t('account.versusPrevious', { value: formatSignedPercent(delta) })}
        </span>
      ) : (
        note && <span className="jx-signals-accountNote">{note}</span>
      )}
    </div>
  );
}

function SignalResult({
  run,
  savingExecutionId,
  onSave,
}: {
  run: SignalRun | null;
  savingExecutionId: string;
  onSave: (executionId: string, input: ActualExecutionUpdate) => void;
}) {
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
  const executions = run.executions ?? [];
  const conditionalSignals = signals.filter((signal) => signal.source === 'conditional');
  const legacyImmediateSignals = signals.filter((signal) => signal.source !== 'conditional');
  return (
    <section className="jx-signals-run">
      <div className="jx-signals-sectionHeading">
        <div>
          <h3 className="jx-signals-sectionTitle">
            {t('runTitle', { date: formatDate(run.tradeDate) })}
          </h3>
          <p className="jx-signals-sectionHint">
            {t('runHint', { date: formatDate(run.execDate) })}
          </p>
        </div>
      </div>
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

      <FactorInputs factors={run.factorInputs ?? []} dependencies={run.factorDependencies ?? []} />

      {signals.length === 0 ? (
        <div className="jx-signals-noAction">
          <FontAwesomeIcon icon={faCircleCheck} />
          <div>
            <strong className="jx-signals-noActionTitle">{t('noAction')}</strong>
            <p className="jx-signals-noActionText">{t('noActionHint')}</p>
          </div>
        </div>
      ) : (
        <>
          {executions.length > 0 ? (
            <Table<SignalExecution>
              className="jx-signals-table"
              rowKey="id"
              columns={executionColumns(t, savingExecutionId, onSave)}
              dataSource={executions}
              pagination={false}
              size="small"
              scroll={{ x: 940 }}
            />
          ) : legacyImmediateSignals.length > 0 ? (
            <Table<SignalItem>
              className="jx-signals-table"
              rowKey={(signal) => `${signal.code}-${signal.source}`}
              columns={legacySignalColumns(t)}
              dataSource={legacyImmediateSignals}
              pagination={false}
              size="small"
            />
          ) : null}
          {conditionalSignals.length > 0 && (
            <div className="jx-signals-conditional">
              <div className="jx-signals-conditionalHeading">
                <h4>{t('conditional.title')}</h4>
                <p>{t('conditional.hint')}</p>
              </div>
              <Table<SignalItem>
                className="jx-signals-table"
                rowKey={(signal) => `${signal.code}-${signal.orderType}`}
                columns={conditionalSignalColumns(t)}
                dataSource={conditionalSignals}
                pagination={false}
                size="small"
                scroll={{ x: 720 }}
              />
            </div>
          )}
        </>
      )}
      <p className="jx-signals-referenceNote">{t('referenceNote')}</p>
    </section>
  );
}

function FactorInputs({
  factors,
  dependencies,
}: {
  factors: FactorInputSummary[];
  dependencies: FactorDependency[];
}) {
  const { t } = useTranslation('signals');
  if (factors.length === 0) {
    return null;
  }
  return (
    <section className="jx-signals-factorInputs" data-testid="signal-factor-inputs">
      <div className="jx-signals-conditionalHeading">
        <h4>{t('factorInputs.title')}</h4>
        <p>{t('factorInputs.hint')}</p>
      </div>
      <Table<FactorInputSummary>
        rowKey="factorId"
        pagination={false}
        size="small"
        columns={[
          {
            title: t('factorInputs.factor'),
            render: (_, factor) => {
              const dependency = dependencies.find((item) => item.factorId === factor.factorId);
              return (
                <span>
                  {dependency?.name ?? factor.key}
                  <code className="jx-signals-code">{factor.key}</code>
                </span>
              );
            },
          },
          {
            title: t('factorInputs.coverage'),
            render: (_, factor) => `${factor.validAssets} / ${factor.observedAssets}`,
          },
          {
            title: t('factorInputs.mean'),
            render: (_, factor) => formatFactorValue(factor.meanValue),
          },
          {
            title: t('factorInputs.decisionValues'),
            render: (_, factor) =>
              factor.decisionObservations.length > 0
                ? factor.decisionObservations
                    .map(
                      (observation) =>
                        `${observation.assetId} ${formatFactorValue(observation.value)}`,
                    )
                    .join(' · ')
                : t('factorInputs.none'),
          },
        ]}
        dataSource={factors}
        scroll={{ x: 720 }}
      />
    </section>
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

function formatFactorValue(value: number | null): string {
  if (value == null) {
    return '—';
  }
  return Math.abs(value) >= 100 ? value.toFixed(2) : value.toFixed(4);
}

function History({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: SignalRun[];
  selectedRunId: string;
  onSelect: (runId: string) => void;
}) {
  const { t } = useTranslation('signals');
  if (runs.length === 0) {
    return null;
  }
  return (
    <section className="jx-signals-history">
      <h3 className="jx-signals-historyTitle">{t('history')}</h3>
      <div className="jx-signals-historyList">
        {runs.map((run) => (
          <button
            type="button"
            className={classNames('jx-signals-historyRow', {
              'jx-signals-historyRow--active': run.id === selectedRunId,
            })}
            key={run.id}
            onClick={() => onSelect(run.id)}
          >
            <span>{formatDate(run.tradeDate)}</span>
            <Tag
              color={run.status === 'done' ? 'green' : run.status === 'running' ? 'blue' : 'red'}
            >
              {t(`status.${run.status}`)}
            </Tag>
            <span>{t('instructionCount', { count: run.signals?.length ?? 0 })}</span>
            <span>{executionProgress(run, t)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ExecutionEditor({
  execution,
  loading,
  onSave,
}: {
  execution: SignalExecution;
  loading: boolean;
  onSave: (input: ActualExecutionUpdate) => void;
}) {
  const { t } = useTranslation('signals');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'filled' | 'skipped' | 'pending'>(execution.actualStatus);
  const [shares, setShares] = useState(execution.actualShares ?? execution.signal.shares);
  const [price, setPrice] = useState(execution.actualPrice ?? execution.simulatedPrice ?? 0);
  const [fee, setFee] = useState<number | null>(execution.actualFee ?? null);
  const [reason, setReason] = useState(execution.actualReason ?? 'manual_override');
  const [note, setNote] = useState(execution.actualNote ?? '');
  const editable = execution.simulatedStatus !== 'pending';

  const submit = () => {
    if (status === 'filled') {
      onSave({
        status,
        shares,
        price,
        ...(fee == null ? {} : { fee }),
        ...(note ? { note } : {}),
      });
    } else if (status === 'skipped') {
      onSave({ status, reason, ...(note ? { note } : {}) });
    } else {
      onSave({ status });
    }
    setOpen(false);
  };

  return (
    <>
      <Button
        size="small"
        icon={<FontAwesomeIcon icon={faPenToSquare} />}
        disabled={!editable}
        loading={loading}
        onClick={() => setOpen(true)}
      >
        {execution.actualStatus === 'pending' ? t('execution.record') : t('execution.edit')}
      </Button>
      <Modal
        open={open}
        title={t('execution.dialogTitle', {
          action: t(`actionType.${execution.signal.action}`),
          name: execution.signal.name,
        })}
        okText={t('execution.save')}
        cancelText={t('execution.cancel')}
        confirmLoading={loading}
        onOk={submit}
        onCancel={() => setOpen(false)}
        okButtonProps={{
          disabled:
            (status === 'filled' && (!shares || !price)) || (status === 'skipped' && !reason),
        }}
      >
        <div className="jx-signals-editor">
          <label className="jx-signals-editorField">
            <span>{t('execution.status')}</span>
            <Select
              className="jx-signals-editorControl"
              value={status}
              options={[
                { value: 'filled', label: t('actualStatus.filled') },
                { value: 'skipped', label: t('actualStatus.skipped') },
                { value: 'pending', label: t('actualStatus.pending') },
              ]}
              onChange={setStatus}
            />
          </label>
          {status === 'filled' && (
            <>
              <label className="jx-signals-editorField">
                <span>{t('execution.filledShares')}</span>
                <InputNumber
                  className="jx-signals-editorControl"
                  min={0.000001}
                  max={execution.signal.shares}
                  value={shares}
                  onChange={(value) => setShares(value ?? 0)}
                />
              </label>
              <label className="jx-signals-editorField">
                <span>{t('execution.filledPrice')}</span>
                <InputNumber
                  className="jx-signals-editorControl"
                  min={0.000001}
                  precision={4}
                  value={price}
                  onChange={(value) => setPrice(value ?? 0)}
                />
              </label>
              <label className="jx-signals-editorField">
                <span>{t('execution.fee')}</span>
                <InputNumber
                  className="jx-signals-editorControl"
                  min={0}
                  precision={2}
                  placeholder={t('execution.feePlaceholder')}
                  value={fee}
                  onChange={setFee}
                />
              </label>
            </>
          )}
          {status === 'skipped' && (
            <label className="jx-signals-editorField">
              <span>{t('execution.reason')}</span>
              <Select
                className="jx-signals-editorControl"
                value={reason}
                options={[
                  { value: 'limit_blocked', label: t('execution.reasons.limitBlocked') },
                  { value: 'suspended', label: t('execution.reasons.suspended') },
                  { value: 'forgotten', label: t('execution.reasons.forgotten') },
                  { value: 'manual_override', label: t('execution.reasons.manualOverride') },
                  { value: 'other', label: t('execution.reasons.other') },
                ]}
                onChange={setReason}
              />
            </label>
          )}
          {status !== 'pending' && (
            <label className="jx-signals-editorField">
              <span>{t('execution.note')}</span>
              <Input.TextArea
                rows={3}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}
        </div>
      </Modal>
    </>
  );
}

function executionColumns(
  t: (key: string, options?: any) => string,
  savingExecutionId: string,
  onSave: (executionId: string, input: ActualExecutionUpdate) => void,
): ColumnsType<SignalExecution> {
  return [
    {
      title: t('instrument'),
      key: 'instrument',
      fixed: 'left',
      width: 150,
      render: (_, execution) => (
        <div>
          <strong>{execution.signal.name}</strong>
          <span className="jx-signals-code">{execution.signal.code}</span>
        </div>
      ),
    },
    {
      title: t('instruction'),
      key: 'instruction',
      width: 150,
      render: (_, execution) => (
        <div>
          <span className={execution.signal.action === 'buy' ? 'text-up' : 'text-down'}>
            {t(`actionType.${execution.signal.action}`)}
          </span>
          <span className="jx-signals-code">
            {execution.signal.shares.toLocaleString()} @ ¥{execution.signal.refPrice.toFixed(2)}
          </span>
        </div>
      ),
    },
    {
      title: t('simulation'),
      key: 'simulation',
      width: 180,
      render: (_, execution) => (
        <ExecutionState
          status={execution.simulatedStatus}
          price={execution.simulatedPrice}
          shares={execution.simulatedShares}
          reason={execution.simulatedReason}
          namespace="simulatedStatus"
        />
      ),
    },
    {
      title: t('actual'),
      key: 'actual',
      width: 180,
      render: (_, execution) => (
        <ExecutionState
          status={execution.actualStatus}
          price={execution.actualPrice}
          shares={execution.actualShares}
          reason={execution.actualReason}
          namespace="actualStatus"
        />
      ),
    },
    {
      title: t('execution.operation'),
      key: 'operation',
      fixed: 'right',
      width: 110,
      render: (_, execution) => (
        <ExecutionEditor
          execution={execution}
          loading={savingExecutionId === execution.id}
          onSave={(input) => onSave(execution.id, input)}
        />
      ),
    },
  ];
}

function ExecutionState({
  status,
  price,
  shares,
  reason,
  namespace,
}: {
  status: string;
  price?: number | null;
  shares?: number | null;
  reason?: string | null;
  namespace: 'simulatedStatus' | 'actualStatus';
}) {
  const { t } = useTranslation('signals');
  const color =
    status === 'filled'
      ? 'green'
      : status === 'blocked' || status === 'skipped'
        ? 'red'
        : 'default';
  return (
    <div className="jx-signals-executionState">
      <Tag color={color}>{t(`${namespace}.${status}`)}</Tag>
      {price != null && shares != null && (
        <span className="jx-signals-executionDetail">
          {shares.toLocaleString()} @ ¥{price.toFixed(2)}
        </span>
      )}
      {reason && (
        <span className="jx-signals-executionReason">{t(`reason.${reason}`, reason)}</span>
      )}
    </div>
  );
}

function legacySignalColumns(t: (key: string, options?: any) => string): ColumnsType<SignalItem> {
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

function conditionalSignalColumns(
  t: (key: string, options?: any) => string,
): ColumnsType<SignalItem> {
  return [
    {
      title: t('instrument'),
      key: 'instrument',
      fixed: 'left',
      width: 170,
      render: (_, signal) => (
        <div>
          <strong>{signal.name}</strong>
          <span className="jx-signals-code">{signal.code}</span>
        </div>
      ),
    },
    {
      title: t('conditional.type'),
      dataIndex: 'orderType',
      width: 150,
      render: (orderType: SignalItem['orderType']) =>
        t(`conditional.orderType.${orderType ?? 'market_open'}`),
    },
    {
      title: t('instruction'),
      key: 'instruction',
      width: 150,
      render: (_, signal) => (
        <div>
          <span className={signal.action === 'buy' ? 'text-up' : 'text-down'}>
            {t(`actionType.${signal.action}`)}
          </span>
          <span className="jx-signals-code">
            {signal.shares.toLocaleString()} {t('shares')}
          </span>
        </div>
      ),
    },
    {
      title: t('conditional.trigger'),
      key: 'trigger',
      align: 'right',
      width: 180,
      render: (_, signal) => (
        <div>
          <strong>¥{signal.triggerPrice?.toFixed(2) ?? '—'}</strong>
          {signal.trailingPct != null && (
            <span className="jx-signals-code">
              {t('conditional.trailing', { value: `${(signal.trailingPct * 100).toFixed(1)}%` })}
            </span>
          )}
        </div>
      ),
    },
  ];
}

function executionProgress(run: SignalRun, t: (key: string, options?: any) => string): string {
  const executions = run.executions ?? [];
  if (executions.length === 0) {
    return '';
  }
  const decided = executions.filter((execution) => execution.actualStatus !== 'pending').length;
  return t('execution.progress', { decided, total: executions.length });
}

function relativeDelta(value?: number | null, base?: number | null): number | null {
  return value == null || base == null || base === 0 ? null : value / base - 1;
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

function formatPercent(value?: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  const percentage = value * 100;
  return `${percentage > 0 ? '+' : ''}${percentage.toFixed(2)}%`;
}
