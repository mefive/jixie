import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import { useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  SignalTask,
  SignalAccounts,
  StrategyExecutionOverview,
  SignalExecutionLeg,
} from '@jixie/shared';
import type { SignalFillInput } from '@jixie/shared/api/signals';
import {
  setSignalTaskDecision,
  recordSignalFill,
  resolveActualSignal,
  retrySignalAccounts,
  reviseSignalFill,
  reviseSignalMarketInput,
} from '@src/api/signals';
import { complex } from './complex';
import './versioned-accounts.css';

export const VersionedAccounts = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('signals');
  const [selected, setSelected] = useState<{
    task: SignalTask;
    mode: 'fill' | 'resolve' | 'skip';
    fillId?: string;
  } | null>(null);
  const history = store.accountLoader.result;
  const [form] = Form.useForm();
  const [error, setError] = useState<string | null>(null);
  const [marketRevisionOpen, setMarketRevisionOpen] = useState(false);
  const [marketForm] = Form.useForm();
  const [requestId, setRequestId] = useState('');
  if (!history) {
    return <Alert type="info" message={t('v2.awaitingBaseline')} />;
  }
  const open = (task: SignalTask, mode: 'fill' | 'resolve' | 'skip') => {
    const intent = task.intent;
    const future = intent.assetType === 'future';
    form.resetFields();
    form.setFieldsValue({
      actualCode: future ? intent.actualCode : intent.code,
      action: future ? 'buy' : intent.action,
      effect: !future && intent.action === 'sell' ? 'close' : 'open',
      price: future ? intent.referencePrice : intent.refPrice,
      quantity: future ? Math.abs(intent.referenceTargetContracts) || 1 : intent.shares,
      fee: 0,
      sequence: 0,
      executedAt: new Date().toISOString(),
      tradeDate: task.execDate,
      exposureAsOf: new Date().toISOString(),
      priceSource: '',
      cashExposure: 0,
    });
    setRequestId(crypto.randomUUID());
    setError(null);
    setSelected({ task, mode });
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      if (!selected) {
        return;
      }
      const common = { expectedRevision: history.revision, clientRequestId: requestId };
      await store.mutateAccount(() =>
        selected.mode === 'skip'
          ? setSignalTaskDecision(selected.task.id, {
              expectedRevision: history.revision,
              status: 'skipped',
              reason: values.reason,
            })
          : selected.mode === 'fill'
            ? selected.fillId
              ? reviseSignalFill(selected.fillId, { ...common, void: false, replacement: values })
              : recordSignalFill(selected.task.id, { ...values, ...common })
            : resolveActualSignal(selected.task.id, { ...values, ...common }),
      );
      setSelected(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('v2.checkFields'));
    }
  };
  const chart: StrategyExecutionOverview = {
    model:
      store.historyLoader.result
        ?.filter((run) => run.modelEquity != null)
        .map((run) => ({ date: run.tradeDate, equity: run.modelEquity })) ?? [],
    simulation: history.simulation.map(accountPoint),
    actual: history.actual.map(accountPoint),
    execution: {
      total: 0,
      filled: 0,
      skipped: 0,
      pending: 0,
      executionRate: null,
      averagePriceDeviationBps: null,
    },
  };

  return (
    <section className="jx-signalAccounts">
      <h3>{t('v2.title')}</h3>
      {store.accountMutationLoader.error && (
        <Alert type="error" message={store.accountMutationLoader.errorObject?.message} />
      )}
      <Alert type="info" message={t('v2.baseline')} description={t('v2.timing')} />
      {history.status !== 'ready' && (
        <Alert
          type="warning"
          message={t('v2.accountState', { state: t(`v2.${history.status}`) })}
          description={history.error}
        />
      )}
      <Button
        loading={store.accountMutationLoader.loading}
        onClick={() =>
          void store
            .mutateAccount(() => retrySignalAccounts(store.selectedDeploymentId))
            .catch(() => {})
        }
      >
        {t('v2.retry')}
      </Button>
      <Button onClick={() => setMarketRevisionOpen(true)}>{t('v2.reviseMarket')}</Button>
      <Modal
        open={marketRevisionOpen}
        title={t('v2.reviseMarket')}
        onCancel={() => setMarketRevisionOpen(false)}
        confirmLoading={store.accountMutationLoader.loading}
        onOk={() =>
          void marketForm
            .validateFields()
            .then((values) =>
              store.mutateAccount(() =>
                reviseSignalMarketInput(store.selectedDeploymentId, {
                  ...values,
                  expectedRevision: history.revision,
                }),
              ),
            )
            .then(() => setMarketRevisionOpen(false))
            .catch(() => {})
        }
      >
        <Alert type="warning" message={t('v2.marketRevisionNotice')} />
        <Form form={marketForm} layout="vertical">
          <Form.Item name="tradeDate" label={t('v2.date')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="reason" label={t('v2.reason')} rules={[{ required: true }]}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <div className="jx-signalAccounts-balances">
        {(['model', 'simulation', 'actual'] as const).map((kind) => {
          const account =
            kind === 'model' ? store.selectedRun?.modelAccounts : history[kind].at(-1);
          return (
            account && (
              <div key={kind} className="jx-signalAccounts-balance">
                <strong>
                  {t(`v2.${kind}`)} · {account.date}
                  {kind !== 'model' && (
                    <Tag>
                      {t(
                        `v2.${kind === 'simulation' ? history.simulationStatus : history.actualStatus}`,
                      )}
                    </Tag>
                  )}
                </strong>
                <p>
                  {t('v2.totalEquity')}: ¥{account.equity.toFixed(2)}
                </p>
                <p>
                  {t('v2.cash')}: ¥{account.cash.toFixed(2)}
                </p>
                <p>
                  {t('v2.futureEquity')}: ¥{account.futures.equity.toFixed(2)}
                </p>
                <p>
                  {t('v2.margin')}: ¥{account.futures.margin.toFixed(2)} · {t('v2.available')}: ¥
                  {account.futures.availableCash.toFixed(2)}
                </p>
                {account.risk.map((risk) => (
                  <Tag key={risk} color="red">
                    {t(`v2.${risk}`)}
                  </Tag>
                ))}
                {account.positions.map((position) => (
                  <p key={position.code}>
                    {position.code} · {Math.round(position.shares * position.adjustmentFactor)}{' '}
                    {t('v2.shares')}
                  </p>
                ))}
                {account.futures.positions.map((position) => (
                  <p key={`${position.code}:${position.actualCode}`}>
                    {position.code} / {position.actualCode} · {position.contracts}{' '}
                    {t('v2.contracts')}
                  </p>
                ))}
              </div>
            )
          );
        })}
      </div>
      <Suspense fallback={null}>
        <ExecutionChart overview={chart} />
      </Suspense>
      {(['cashTasks', 'futureTasks'] as const).map((group) => {
        const tasks = history.tasks.filter(
          (task) => (task.intent.assetType === 'future') === (group === 'futureTasks'),
        );
        const count = (status: string) =>
          tasks.filter((task) => task.summary?.status === status).length;
        const decided = count('filled') + count('partial') + count('skipped');
        return (
          <p key={group}>
            {t(`v2.${group}`)} ·{' '}
            {t('v2.executionStats', {
              filled: count('filled'),
              partial: count('partial'),
              pending: count('pending'),
              skipped: count('skipped'),
              rate: decided ? `${((count('filled') / decided) * 100).toFixed(1)}%` : '—',
            })}
          </p>
        );
      })}
      <Table<SignalTask>
        rowKey="id"
        dataSource={history.tasks}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 850 }}
        columns={[
          { title: t('v2.date'), dataIndex: 'execDate' },
          {
            title: t('v2.instrument'),
            render: (_, task) => (
              <>
                {task.intent.code}
                {!task.sourceRunId && <Tag>{t('v2.maintenance')}</Tag>}
                {task.maintenanceConflict && (
                  <Alert type="warning" message={t('v2.maintenanceConflict')} />
                )}
              </>
            ),
          },
          {
            title: t('v2.intent'),
            render: (_, task) =>
              task.intent.assetType === 'future'
                ? t(
                    `v2.${task.intent.intent.kind === 'contracts' ? 'targetContracts' : task.intent.intent.kind}`,
                    { value: task.intent.intent.value },
                  )
                : t(`action.${task.intent.action}`),
          },
          {
            title: t('v2.reference'),
            render: (_, task) =>
              task.intent.assetType === 'future' ? (
                <>
                  {task.intent.referenceTargetContracts} {t('v2.contracts')}
                  <br />
                  {task.intent.actualCode}
                  <br />¥{task.intent.referenceNotional.toFixed(2)}
                  <br />
                  {t('v2.margin')}: ¥{task.intent.referenceMargin.toFixed(2)} (
                  {t(`v2.${task.intent.marginSource}`)})
                </>
              ) : (
                `${task.intent.shares} ${t('v2.shares')}`
              ),
          },
          {
            title: t('v2.executionStatus'),
            render: (_, task) => (
              <>
                {t(`v2.${task.summary?.status ?? 'pending'}`)}
                {task.summary?.averagePriceDeviationBps != null && (
                  <p>{task.summary.averagePriceDeviationBps.toFixed(2)} bp</p>
                )}
              </>
            ),
          },
          {
            title: t('v2.actions'),
            render: (_, task) => (
              <div className="jx-signalAccounts-actions">
                {task.intent.assetType === 'future' && (
                  <Button onClick={() => open(task, 'resolve')}>{t('v2.resolve')}</Button>
                )}
                <Button onClick={() => open(task, 'fill')}>{t('v2.record')}</Button>
                <Button onClick={() => open(task, 'skip')}>{t('v2.skip')}</Button>
              </div>
            ),
          },
        ]}
        expandable={{
          expandedRowRender: (task) => (
            <>
              {task.resolutions
                .filter((row) => row.kind === 'actual')
                .slice(0, 1)
                .map((row) => {
                  const payload = row.payload as { legs?: SignalExecutionLeg[]; status?: string };
                  return (
                    <div key={row.id}>
                      <strong>{t('v2.resolution')}</strong>
                      {payload.legs?.length ? (
                        payload.legs.map((leg) => (
                          <p key={leg.id}>
                            {leg.actualCode} · {t(`v2.${leg.action}`)} · {t(`v2.${leg.effect}`)} ·{' '}
                            {leg.contracts} {t('v2.contracts')} · {t(`v2.${leg.positionSide}`)}
                            <Button
                              onClick={() => {
                                open(task, 'fill');
                                form.setFieldsValue({
                                  actualCode: leg.actualCode,
                                  action: leg.action,
                                  effect: leg.effect,
                                  quantity: leg.contracts,
                                  resolutionId: row.id,
                                  legId: leg.id,
                                });
                              }}
                            >
                              {t('v2.recordLeg')}
                            </Button>
                          </p>
                        ))
                      ) : (
                        <p>{t('v2.noAction')}</p>
                      )}
                    </div>
                  );
                })}
              {task.resolutions
                .filter((row) => row.kind === 'simulation')
                .slice(0, 1)
                .map((row) => {
                  const payload = row.payload as {
                    trades?: Array<{
                      actualCode?: string;
                      code: string;
                      side: string;
                      contracts?: number;
                      realPrice?: number;
                      realShares?: number;
                      price: number;
                    }>;
                  };
                  return (
                    <div key={row.id}>
                      <strong>{t('v2.simulation')}</strong>
                      {payload.trades?.length ? (
                        payload.trades.map((trade, index) => (
                          <p key={index}>
                            {trade.actualCode ?? trade.code} · {t(`v2.${trade.side}`)} ·{' '}
                            {trade.contracts ?? trade.realShares} @ {trade.realPrice ?? trade.price}
                          </p>
                        ))
                      ) : (
                        <p>{t('v2.noFill')}</p>
                      )}
                    </div>
                  );
                })}
              <p>
                {task.actualStatus === 'skipped' ? t('v2.skipped') : t('v2.fillState')} ·{' '}
                {task.actualReason}
              </p>
              <strong>{t('v2.fills')}</strong>
              {task.fills.map((fill) => {
                const payload = fill.payload as SignalFillInput;
                const inactive =
                  fill.voided || task.fills.some((row) => row.replacesId === fill.id);
                return (
                  <div className="jx-signalAccounts-fill" key={fill.id}>
                    <span>
                      {payload.actualCode} · {t(`v2.${payload.action}`)} /{' '}
                      {t(`v2.${payload.effect}`)} · {payload.quantity} @ {payload.price} ·{' '}
                      {payload.executedAt} · {payload.reason}
                    </span>
                    {!inactive && (
                      <Button
                        onClick={() => {
                          open(task, 'fill');
                          form.setFieldsValue(payload);
                          setSelected({ task, mode: 'fill', fillId: fill.id });
                        }}
                      >
                        {t('v2.edit')}
                      </Button>
                    )}
                    {inactive ? (
                      <Tag>{t('v2.superseded')}</Tag>
                    ) : (
                      <Button
                        danger
                        loading={store.accountMutationLoader.loading}
                        onClick={() =>
                          void store
                            .mutateAccount(() =>
                              reviseSignalFill(fill.id, {
                                expectedRevision: history.revision,
                                clientRequestId: crypto.randomUUID(),
                                void: true,
                              }),
                            )
                            .catch(() => {})
                        }
                      >
                        {t('v2.void')}
                      </Button>
                    )}
                  </div>
                );
              })}
            </>
          ),
        }}
      />
      <Modal
        open={!!selected}
        title={t(
          selected?.mode === 'resolve'
            ? 'v2.resolve'
            : selected?.mode === 'skip'
              ? 'v2.skip'
              : 'v2.record',
        )}
        onCancel={() => setSelected(null)}
        onOk={() => void save()}
        confirmLoading={store.accountMutationLoader.loading}
        destroyOnHidden
      >
        {error && <Alert type="error" message={error} />}
        <Form form={form} layout="vertical">
          <Form.Item name="resolutionId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="legId" hidden>
            <Input />
          </Form.Item>
          {selected?.mode === 'skip' ? (
            <Form.Item name="reason" label={t('v2.reason')} rules={[{ required: true }]}>
              <Input.TextArea />
            </Form.Item>
          ) : selected?.mode === 'resolve' ? (
            <>
              <Form.Item name="cashExposure" label={t('v2.exposure')} rules={[{ required: true }]}>
                <InputNumber min={0} />
              </Form.Item>
              <Form.Item name="exposureAsOf" label={t('v2.asOf')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item
                name="priceSource"
                label={t('v2.priceSource')}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="dependenciesConfirmed"
                valuePropName="checked"
                rules={[
                  {
                    validator: (_, value) =>
                      value
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('v2.confirmDependencies'))),
                  },
                ]}
              >
                <Checkbox>{t('v2.confirmDependencies')}</Checkbox>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="actualCode" label={t('v2.actualCode')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="action" label={t('v2.direction')} rules={[{ required: true }]}>
                <Select
                  options={['buy', 'sell'].map((value) => ({ value, label: t(`v2.${value}`) }))}
                />
              </Form.Item>
              <Form.Item name="effect" label={t('v2.effect')} rules={[{ required: true }]}>
                <Select
                  options={['open', 'close'].map((value) => ({ value, label: t(`v2.${value}`) }))}
                />
              </Form.Item>
              <Form.Item
                name="quantity"
                label={t(
                  selected?.task.intent.assetType === 'future' ? 'v2.contracts' : 'v2.shares',
                )}
                rules={[{ required: true }]}
              >
                <InputNumber
                  min={1}
                  precision={selected?.task.intent.assetType === 'future' ? 0 : undefined}
                />
              </Form.Item>
              <Form.Item name="fee" label={t('v2.fee')} rules={[{ required: true }]}>
                <InputNumber min={0} />
              </Form.Item>
              <Form.Item name="tradeDate" label={t('v2.date')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="executedAt" label={t('v2.executedAt')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="sequence" label={t('v2.sequence')} rules={[{ required: true }]}>
                <InputNumber min={0} precision={0} />
              </Form.Item>
              <Form.Item name="reason" label={t('v2.reason')} rules={[{ required: true }]}>
                <Input.TextArea />
              </Form.Item>
            </>
          )}
          {selected?.mode !== 'skip' && (
            <Form.Item name="price" label={t('v2.price')} rules={[{ required: true }]}>
              <InputNumber min={0.000001} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </section>
  );
}, 'VersionedAccounts');

const ExecutionChart = lazy(() => import('./execution-chart'));
function accountPoint(account: SignalAccounts) {
  return {
    date: account.date,
    cash: account.cash,
    marketValue: account.positions.reduce(
      (sum, position) => sum + position.shares * position.markPrice,
      0,
    ),
    equity: account.equity,
    isBaseline: false,
  };
}
