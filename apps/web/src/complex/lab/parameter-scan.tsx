import { lazy, Suspense, useState } from 'react';
import type {
  BacktestMetricSummary,
  StrategyParamValue,
  StrategyScanReport,
  StrategyScanSpec,
} from '@jixie/shared';
import { faFlask } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Segmented,
  Select,
  Table,
  Tooltip,
} from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { LogView } from '@src/components/log-view';
import { complex } from './complex';
import './parameter-scan.css';

const ParameterScanChart = lazy(() => import('./parameter-scan-chart'));
type ScanView = 'parameters' | 'sizing' | 'capacity';

export const ParameterScanButton = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const [open, setOpen] = useState(false);
  const [firstKey, setFirstKey] = useState('');
  const [secondKey, setSecondKey] = useState('');
  const [firstValues, setFirstValues] = useState('');
  const [secondValues, setSecondValues] = useState('');
  const [twoDimensions, setTwoDimensions] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitDate, setSplitDate] = useState<string>();
  const [formError, setFormError] = useState('');
  const [view, setView] = useState<ScanView>('parameters');
  const [capitalValues, setCapitalValues] = useState(suggestedCapitalValues);

  const openModal = async () => {
    setOpen(true);
    setFormError('');
    try {
      const parameters = await store.loadScanParameters();
      const entries = Object.entries(parameters);
      const first = entries[0];
      const second = entries[1];
      setFirstKey(first?.[0] ?? '');
      setFirstValues(first ? suggestedValues(first[1]) : '');
      setSecondKey(second?.[0] ?? '');
      setSecondValues(second ? suggestedValues(second[1]) : '');
      setCapitalValues(suggestedCapitalValues());
    } catch {
      /* Loader error is rendered in the modal. */
    }
  };

  const submit = () => {
    try {
      if (view === 'capacity') {
        const spec: StrategyScanSpec = {
          dimensions: [
            {
              key: 'initialCash',
              values: parseCapitalValues(capitalValues, t('scanCapitalValuesInvalid')),
            },
          ],
          view,
        };
        setOpen(false);
        void store.runScan(spec);
        return;
      }
      const firstDefault = parameters[firstKey];
      const dimensions = [
        {
          key: firstKey,
          values: parseValues(firstValues, firstDefault, t('scanValuesInvalid')),
        },
      ];
      if (twoDimensions && view === 'parameters') {
        dimensions.push({
          key: secondKey,
          values: parseValues(secondValues, parameters[secondKey], t('scanValuesInvalid')),
        });
      }
      const spec: StrategyScanSpec = {
        dimensions,
        splitDate: splitEnabled && view === 'parameters' ? splitDate : undefined,
        view,
      };
      if (splitEnabled && !splitDate) {
        throw new Error(t('scanSplitRequired'));
      }
      setOpen(false);
      void store.runScan(spec);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('scanValuesInvalid'));
    }
  };

  const parameters = store.scanParametersLoader.result ?? {};
  const parameterOptions = Object.entries(parameters).map(([key, value]) => ({
    value: key,
    label: `${key} (${value})`,
  }));
  const sizingOptions = parameterOptions.filter(
    (option) => typeof parameters[option.value] === 'string',
  );
  const activeOptions = view === 'sizing' ? sizingOptions : parameterOptions;

  const changeView = (next: string | number) => {
    const nextView = next as ScanView;
    setView(nextView);
    setTwoDimensions(false);
    setSplitEnabled(false);
    if (nextView === 'capacity') {
      setFirstKey('');
      setFirstValues('');
      return;
    }
    const options = nextView === 'sizing' ? sizingOptions : parameterOptions;
    const first = options[0];
    setFirstKey(first?.value ?? '');
    setFirstValues(first ? suggestedValues(parameters[first.value], nextView) : '');
  };

  return (
    <>
      <Tooltip title={t('scanAction')}>
        <Button
          type="text"
          size="small"
          icon={<FontAwesomeIcon icon={faFlask} />}
          disabled={store.running || store.scanPoller.running}
          aria-label={t('scanAction')}
          onClick={() => void openModal()}
        />
      </Tooltip>
      <Modal
        open={open}
        title={t('scanTitle')}
        okText={t('scanStart')}
        okButtonProps={{
          disabled:
            view !== 'capacity' &&
            (store.scanParametersLoader.loading || activeOptions.length === 0),
        }}
        onOk={submit}
        onCancel={() => setOpen(false)}
      >
        <div className="jx-parameterScan-form">
          <p className="jx-parameterScan-note">{t('scanIntro')}</p>
          <Segmented
            block
            value={view}
            options={[
              { value: 'parameters', label: t('scanViewParameters') },
              { value: 'sizing', label: t('scanViewSizing') },
              { value: 'capacity', label: t('scanViewCapacity') },
            ]}
            onChange={changeView}
          />
          {view === 'capacity' ? (
            <div className="jx-parameterScan-dimension">
              <div className="jx-parameterScan-label">{t('scanCapitalValues')}</div>
              <Input
                className="jx-parameterScan-control"
                value={capitalValues}
                placeholder={t('scanCapitalValuesPlaceholder')}
                onChange={(event) => setCapitalValues(event.target.value)}
              />
              <div className="jx-parameterScan-capitalHint">{t('scanCapitalValuesHint')}</div>
            </div>
          ) : store.scanParametersLoader.loading ? (
            <div className="jx-parameterScan-empty">{t('scanReadingParams')}</div>
          ) : store.scanParametersLoader.error ? (
            <div className="jx-parameterScan-error">{String(store.scanParametersLoader.error)}</div>
          ) : activeOptions.length === 0 ? (
            <div className="jx-parameterScan-empty">
              {t(view === 'sizing' ? 'scanNoSizingParam' : 'scanNoParams')}
            </div>
          ) : (
            <>
              <ScanDimension
                label={t('scanDimensionOne')}
                parameter={firstKey}
                values={firstValues}
                options={activeOptions}
                onParameter={(key) => {
                  setFirstKey(key);
                  setFirstValues(suggestedValues(parameters[key], view));
                }}
                onValues={setFirstValues}
              />
              {view === 'parameters' ? (
                <Checkbox
                  checked={twoDimensions}
                  disabled={parameterOptions.length < 2}
                  onChange={(event) => setTwoDimensions(event.target.checked)}
                >
                  {t('scanTwoDimensions')}
                </Checkbox>
              ) : null}
              {twoDimensions && view === 'parameters' ? (
                <ScanDimension
                  label={t('scanDimensionTwo')}
                  parameter={secondKey}
                  values={secondValues}
                  options={parameterOptions.filter((option) => option.value !== firstKey)}
                  onParameter={(key) => {
                    setSecondKey(key);
                    setSecondValues(suggestedValues(parameters[key], 'parameters'));
                  }}
                  onValues={setSecondValues}
                />
              ) : null}
              {view === 'parameters' ? (
                <Checkbox
                  checked={splitEnabled}
                  onChange={(event) => setSplitEnabled(event.target.checked)}
                >
                  {t('scanUseSplit')}
                </Checkbox>
              ) : null}
              {splitEnabled && view === 'parameters' ? (
                <DatePicker
                  className="jx-parameterScan-control"
                  value={splitDate ? dayjs(splitDate, 'YYYYMMDD') : null}
                  format="YYYY-MM-DD"
                  minDate={dayjs(store.start, 'YYYYMMDD').add(1, 'day')}
                  maxDate={dayjs(store.end, 'YYYYMMDD').subtract(1, 'day')}
                  onChange={(date) => setSplitDate(date?.format('YYYYMMDD'))}
                />
              ) : null}
            </>
          )}
          {formError ? <div className="jx-parameterScan-error">{formError}</div> : null}
        </div>
      </Modal>
    </>
  );
}, 'ParameterScanButton');

export const ParameterScanPanel = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const [metric, setMetric] = useState<ScanMetric>('annReturn');
  const report = store.scanReport;
  const history = store.scanHistoryLoader.result ?? [];
  const historyOptions = history.map((item) => ({
    value: item.id,
    label: `${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')} · ${t(`scanStatus.${item.status}`)}`,
  }));

  return (
    <div className="jx-parameterScan">
      <div className="jx-parameterScan-toolbar">
        <ParameterScanButton />
        <Select
          className="jx-parameterScan-history"
          placeholder={t('scanHistory')}
          options={historyOptions}
          value={report?.id}
          allowClear={false}
          onChange={(reportId) => void store.loadScanReport(reportId)}
        />
        {report?.spec.view !== 'sizing' && report?.spec.view !== 'capacity' ? (
          <Select
            className="jx-parameterScan-metric"
            value={metric}
            options={SCAN_METRICS.map((item) => ({
              value: item.key,
              label: t(item.labelKey),
            }))}
            onChange={setMetric}
          />
        ) : null}
      </div>

      {store.scanError ? <div className="jx-parameterScan-error">{store.scanError}</div> : null}
      {store.scanPoller.running ? (
        <div className="jx-parameterScan-progress">
          <LogView lines={store.scanLogLines} emptyText={t('scanStarting')} />
        </div>
      ) : null}
      {!report && !store.scanPoller.running ? (
        <div className="jx-parameterScan-empty">{t('scanEmpty')}</div>
      ) : null}
      {report?.status === 'done' && report.payload ? (
        <>
          <div className="jx-parameterScan-meta">
            {t('scanMeta', {
              count: report.payload.cells.length,
              hash: report.codeHash.slice(0, 10),
              cutoff: report.dataCutoff ?? '—',
            })}
          </div>
          <Suspense fallback={<div className="jx-parameterScan-chart" />}>
            <ParameterScanChart report={report} metric={metric} />
          </Suspense>
          {report.spec.view === 'sizing' ? <SizingTable report={report} /> : null}
          {report.spec.view === 'capacity' ? <CapacitySummary report={report} /> : null}
          {!report.spec.view || report.spec.view === 'parameters' ? (
            <ScanTable report={report} metric={metric} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}, 'ParameterScanPanel');

interface ScanDimensionProps {
  label: string;
  parameter: string;
  values: string;
  options: { value: string; label: string }[];
  onParameter(value: string): void;
  onValues(value: string): void;
}

function SizingTable({ report }: { report: StrategyScanReport }) {
  const { t } = useTranslation('lab');
  const dimension = report.spec.dimensions[0];
  const rows = report.payload!.cells.map((cell, index) => ({
    key: index,
    scheme: String(cell.params[dimension.key]),
    annReturn: formatMetric('annReturn', cell.full),
    maxDrawdown: formatMetric('maxDrawdown', cell.full),
    annVolatility: formatMetric('annVolatility', cell.full),
    maxUnderwaterDays: formatMetric('maxUnderwaterDays', cell.full),
    sharpe: formatMetric('sharpe', cell.full),
  }));
  return (
    <Table
      className="jx-parameterScan-table"
      size="small"
      pagination={false}
      columns={[
        { title: dimension.key, dataIndex: 'scheme', key: 'scheme' },
        { title: t('metricAnnReturn'), dataIndex: 'annReturn', key: 'annReturn' },
        { title: t('metricMaxDrawdown'), dataIndex: 'maxDrawdown', key: 'maxDrawdown' },
        { title: t('scanMetricVolatility'), dataIndex: 'annVolatility', key: 'annVolatility' },
        {
          title: t('scanMetricUnderwater'),
          dataIndex: 'maxUnderwaterDays',
          key: 'maxUnderwaterDays',
        },
        { title: t('scanMetricSharpe'), dataIndex: 'sharpe', key: 'sharpe' },
      ]}
      dataSource={rows}
      scroll={{ x: true }}
    />
  );
}

function CapacitySummary({ report }: { report: StrategyScanReport }) {
  const { t, i18n } = useTranslation('lab');
  const dimension = report.spec.dimensions[0];
  const cells = [...report.payload!.cells].sort(
    (first, second) => Number(first.params[dimension.key]) - Number(second.params[dimension.key]),
  );
  const baseline = cells[0];
  const baselineReturn = baseline.full?.annReturn;
  const slippageThreshold = cells.find((cell) => (cell.full?.annSlippageDrag ?? 0) >= 0.01);
  const halfReturnThreshold =
    baselineReturn != null && baselineReturn > 0
      ? cells.slice(1).find((cell) => (cell.full?.annReturn ?? Infinity) <= baselineReturn / 2)
      : undefined;
  const capital = (cell: (typeof cells)[number] | undefined) =>
    cell
      ? formatCapital(Number(cell.params[dimension.key]), i18n.resolvedLanguage)
      : t('scanNotReached');
  const rows = cells.map((cell, index) => ({
    key: index,
    capital: formatCapital(Number(cell.params[dimension.key]), i18n.resolvedLanguage),
    annReturn: formatMetric('annReturn', cell.full),
    annSlippageDrag: formatMetric('annSlippageDrag', cell.full),
    totalSlippage: formatMetric('totalSlippage', cell.full),
    maxDrawdown: formatMetric('maxDrawdown', cell.full),
    trades: cell.full?.trades ?? '—',
  }));

  return (
    <>
      <div className="jx-parameterScan-capacityInsights">
        <div className="jx-parameterScan-capacityInsight">
          <span>{t('scanCapacityBaseline')}</span>
          <strong className="jx-parameterScan-capacityValue">{capital(baseline)}</strong>
        </div>
        <div className="jx-parameterScan-capacityInsight">
          <span>{t('scanCapacitySlippageThreshold')}</span>
          <strong className="jx-parameterScan-capacityValue">{capital(slippageThreshold)}</strong>
        </div>
        <div className="jx-parameterScan-capacityInsight">
          <span>{t('scanCapacityHalfReturnThreshold')}</span>
          <strong className="jx-parameterScan-capacityValue">{capital(halfReturnThreshold)}</strong>
        </div>
      </div>
      <Table
        className="jx-parameterScan-table"
        size="small"
        pagination={false}
        columns={[
          { title: t('scanCapital'), dataIndex: 'capital', key: 'capital' },
          { title: t('metricAnnReturn'), dataIndex: 'annReturn', key: 'annReturn' },
          {
            title: t('scanMetricSlippageDrag'),
            dataIndex: 'annSlippageDrag',
            key: 'annSlippageDrag',
          },
          { title: t('metricSlippage'), dataIndex: 'totalSlippage', key: 'totalSlippage' },
          { title: t('metricMaxDrawdown'), dataIndex: 'maxDrawdown', key: 'maxDrawdown' },
          { title: t('metricTrades'), dataIndex: 'trades', key: 'trades' },
        ]}
        dataSource={rows}
        scroll={{ x: true }}
      />
    </>
  );
}

function ScanDimension(props: ScanDimensionProps) {
  const { t } = useTranslation('lab');
  return (
    <div className="jx-parameterScan-dimension">
      <div className="jx-parameterScan-label">{props.label}</div>
      <Select
        className="jx-parameterScan-control"
        value={props.parameter}
        options={props.options}
        onChange={props.onParameter}
      />
      <Input
        className="jx-parameterScan-control"
        value={props.values}
        placeholder={t('scanValuesPlaceholder')}
        onChange={(event) => props.onValues(event.target.value)}
      />
    </div>
  );
}

function ScanTable({ report, metric }: { report: StrategyScanReport; metric: ScanMetric }) {
  const { t } = useTranslation('lab');
  const dimensions = report.spec.dimensions;
  const split = !!report.spec.splitDate;
  const columns = [
    ...dimensions.map((dimension) => ({
      title: dimension.key,
      dataIndex: dimension.key,
      key: dimension.key,
    })),
    ...(split
      ? [
          {
            title: t('scanInSample'),
            dataIndex: 'inSample',
            key: 'inSample',
          },
          {
            title: t('scanOutOfSample'),
            dataIndex: 'outOfSample',
            key: 'outOfSample',
          },
        ]
      : [{ title: t('scanFullSample'), dataIndex: 'full', key: 'full' }]),
  ];
  const rows = report.payload!.cells.map((cell, index) => ({
    key: index,
    ...cell.params,
    full: formatMetric(metric, cell.full),
    inSample: formatMetric(metric, cell.inSample),
    outOfSample: formatMetric(metric, cell.outOfSample),
  }));
  return (
    <Table
      className="jx-parameterScan-table"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={rows}
      scroll={{ x: true }}
    />
  );
}

export type ScanMetric =
  | 'annReturn'
  | 'sharpe'
  | 'maxDrawdown'
  | 'excessReturn'
  | 'turnover'
  | 'totalSlippage'
  | 'annVolatility'
  | 'maxUnderwaterDays'
  | 'annSlippageDrag';

export const SCAN_METRICS: { key: ScanMetric; labelKey: string }[] = [
  { key: 'annReturn', labelKey: 'metricAnnReturn' },
  { key: 'sharpe', labelKey: 'scanMetricSharpe' },
  { key: 'maxDrawdown', labelKey: 'metricMaxDrawdown' },
  { key: 'excessReturn', labelKey: 'metricExcessReturn' },
  { key: 'turnover', labelKey: 'metricTurnover' },
  { key: 'totalSlippage', labelKey: 'metricSlippage' },
  { key: 'annVolatility', labelKey: 'scanMetricVolatility' },
  { key: 'maxUnderwaterDays', labelKey: 'scanMetricUnderwater' },
];

export function metricValue(
  metric: ScanMetric,
  summary?: BacktestMetricSummary,
): number | undefined {
  return summary?.[metric];
}

function formatMetric(metric: ScanMetric, summary?: BacktestMetricSummary): string {
  const value = metricValue(metric, summary);
  if (value == null) {
    return '—';
  }
  switch (metric) {
    case 'annReturn':
    case 'maxDrawdown':
    case 'excessReturn':
    case 'annVolatility':
    case 'annSlippageDrag':
      return `${(value * 100).toFixed(2)}%`;
    case 'turnover':
      return `${value.toFixed(1)}×`;
    case 'totalSlippage':
      return `¥${Math.round(value).toLocaleString()}`;
    case 'sharpe':
      return value.toFixed(2);
    case 'maxUnderwaterDays':
      return `${Math.round(value)}`;
  }
}

function parseValues(
  raw: string,
  declared: StrategyParamValue | undefined,
  errorMessage: string,
): StrategyParamValue[] {
  const tokens = raw.split(/[\s,，]+/).filter(Boolean);
  if (typeof declared === 'number') {
    const values = tokens.map(Number);
    if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(errorMessage);
    }
    return [...new Set(values)];
  }
  if (tokens.length < 2) {
    throw new Error(errorMessage);
  }
  return [...new Set(tokens)];
}

function suggestedValues(
  value: StrategyParamValue | undefined,
  view: Exclude<ScanView, 'capacity'> = 'parameters',
): string {
  if (typeof value === 'string') {
    return view === 'sizing' ? [...new Set([value, 'equal', 'fixed', 'atr'])].join(', ') : value;
  }
  if (value == null) {
    return '';
  }
  const candidates =
    value === 0
      ? [-1, 0, 1]
      : [value * 0.5, value, value * 1.5].map((candidate) =>
          Number.isInteger(value)
            ? Math.max(1, Math.round(candidate))
            : Number(candidate.toPrecision(6)),
        );
  return [...new Set(candidates)].join(', ');
}

function parseCapitalValues(raw: string, errorMessage: string): number[] {
  const values = raw
    .split(/[\s,，]+/)
    .filter(Boolean)
    .map(Number);
  const unique = [...new Set(values)];
  if (
    unique.length < 3 ||
    unique.length > 7 ||
    unique.some((value) => !Number.isFinite(value) || value < 1 || value > 1_000_000)
  ) {
    throw new Error(errorMessage);
  }
  return unique.map((value) => value * 10_000);
}

function suggestedCapitalValues(): string {
  return '50, 200, 1000, 5000, 20000';
}

function formatCapital(value: number, language?: string): string {
  return new Intl.NumberFormat(language?.startsWith('en') ? 'en-US' : 'zh-CN', {
    style: 'currency',
    currency: 'CNY',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
