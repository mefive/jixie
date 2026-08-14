import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  InputNumber,
  Select,
  Table,
  Tabs,
  Tag,
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  MultivariateTimeSeriesPlanSpecV1,
  MultivariateTimeSeriesRunResultV1,
  ResearchRunRecordRefV1,
  ResearchTransformV1,
} from '@jixie/shared';
import {
  faCode,
  faFlask,
  faRotate,
  faSliders,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { EChart, type ECOption } from './echart';
import { Markdown } from './markdown';
import { ResearchFormulae } from './research-formulae';
import {
  ResearchFailedAttemptNotice,
  ResearchFingerprintDetails,
  ResearchRunComparisonNotice,
  ResearchRunHistorySelect,
  useResearchRunHistory,
} from './research-run-history';

interface Props {
  title: string;
  run: MultivariateTimeSeriesRunResultV1;
  record?: ResearchRunRecordRefV1;
}

export function MultivariateTimeSeriesCard({ title, run: initialRun, record }: Props) {
  const { t, i18n } = useTranslation('research');
  const history = useResearchRunHistory(initialRun, record);
  const run = history.run;
  const result = run.result;
  const conclusion = run.conclusion;
  const zh = i18n.language.startsWith('zh');
  const [draft, setDraft] = useState(() => structuredClone(initialRun.plan));
  const [controlsOpen, setControlsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const focal = result.coefficients.find((coefficient) => coefficient.role === 'focal')!;

  useEffect(() => {
    setDraft(structuredClone(run.plan));
    setControlsOpen(false);
    setRunError('');
  }, [run]);

  const rerun = async () => {
    setRunning(true);
    setRunError('');
    try {
      const next = await history.rerun(draft);
      setDraft(structuredClone(next.plan));
      setControlsOpen(false);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t('result.rerunFailed'));
    } finally {
      setRunning(false);
    }
  };

  const tabs = [
    {
      key: 'coefficients',
      label: t('multivariate.coefficients'),
      children: (
        <div className="jx-researchResult-panelStack">
          <EChart
            className="jx-researchResult-chart"
            option={coefficientOption(run, t('multivariate.standardizedCoefficient'))}
          />
          <CoefficientTable run={run} />
        </div>
      ),
    },
    {
      key: 'partial',
      label: t('multivariate.partialRegression'),
      children: (
        <EChart
          className="jx-researchResult-chart"
          option={partialRegressionOption(
            result.partialRegression.map((point) => [point.focalResidual, point.outcomeResidual]),
            focal.estimate,
            t('multivariate.focalResidual'),
            t('multivariate.outcomeResidual'),
          )}
        />
      ),
    },
    {
      key: 'correlations',
      label: t('multivariate.correlationMatrix'),
      children: <EChart className="jx-researchResult-chart" option={correlationOption(run)} />,
    },
    ...(result.rolling.length > 0
      ? [
          {
            key: 'rolling',
            label: t('multivariate.rollingCoefficient'),
            children: (
              <EChart
                className="jx-researchResult-chart"
                option={rollingOption(
                  run,
                  t('multivariate.focalCoefficient'),
                  t('multivariate.lower95'),
                  t('multivariate.upper95'),
                )}
              />
            ),
          },
        ]
      : []),
    {
      key: 'coverage',
      label: t('result.coverage'),
      children: (
        <div className="jx-researchResult-coverage">
          {run.coverage.map((item) => (
            <section key={item.inputId} className="jx-researchResult-coverageItem">
              <h4>{seriesLabel(run, item.inputId)}</h4>
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 2 }}
                items={[
                  {
                    key: 'loaded',
                    label: t('result.observationsLoaded'),
                    children: item.observationsLoaded,
                  },
                  {
                    key: 'aligned',
                    label: t('result.observationsAligned'),
                    children: item.observationsAligned,
                  },
                  {
                    key: 'range',
                    label: t('result.actualRange'),
                    children: `${formatDate(item.firstDate ?? '')} — ${formatDate(item.lastDate ?? '')}`,
                  },
                  {
                    key: 'missing',
                    label: t('result.missingAfterAlignment'),
                    children: item.missingAfterAlignment,
                  },
                ]}
              />
            </section>
          ))}
        </div>
      ),
    },
    {
      key: 'method',
      label: t('result.method'),
      children: (
        <div className="jx-researchResult-method">
          <Descriptions
            size="small"
            column={1}
            items={[
              { key: 'question', label: t('result.question'), children: run.plan.question.text },
              {
                key: 'hypothesis',
                label: t('result.hypothesis'),
                children: t(`result.hypothesisDirection.${run.plan.question.hypothesis.direction}`),
              },
              {
                key: 'period',
                label: t('result.period'),
                children: `${formatDate(run.plan.start)} — ${formatDate(run.plan.end)}`,
              },
              {
                key: 'outcome',
                label: t('result.outcome'),
                children: seriesLabel(run, run.plan.protocol.outcome),
              },
              {
                key: 'focal',
                label: t('multivariate.focalPredictor'),
                children: seriesLabel(run, conclusion.focalPredictor),
              },
              {
                key: 'controls',
                label: t('multivariate.controls'),
                children: run.plan.protocol.predictors
                  .filter((item) => item.role === 'control')
                  .map((item) => seriesLabel(run, item.input))
                  .join('、'),
              },
              { key: 'hac', label: t('result.hacLag'), children: result.neweyWestLag },
            ]}
          />
          <ResearchFormulae formulae={run.protocol.formulae} zh={zh} />
          <ResearchFingerprintDetails run={run} />
          <section className="jx-researchResult-code">
            <h4>
              <FontAwesomeIcon icon={faCode} /> {t('result.pythonExample')}
            </h4>
            <Markdown text={`\`\`\`python\n${run.protocol.pythonExample}\n\`\`\``} />
          </section>
          <div className="jx-researchResult-docs">
            <FontAwesomeIcon icon={faSquareRootVariable} />
            {run.protocol.helpSlugs[zh ? 'zh' : 'en'].map((slug) => (
              <a key={slug} href={slug} target="_blank" rel="noreferrer">
                {t('result.readConcept')}
              </a>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <Card className="jx-researchResult" size="small">
      <div className="jx-researchResult-head">
        <div className="jx-researchResult-title">
          <FontAwesomeIcon icon={faFlask} />
          <span>{title}</span>
        </div>
        <div className="jx-researchResult-actions">
          <ResearchRunHistorySelect
            records={history.records}
            runId={history.record?.runId}
            label={t('result.runHistory')}
            onChange={history.select}
          />
          <Tag>{zh ? run.protocol.nameZh : run.protocol.nameEn}</Tag>
          <Button
            size="small"
            icon={<FontAwesomeIcon icon={faSliders} />}
            onClick={() => setControlsOpen((open) => !open)}
          >
            {t('result.parameters')}
          </Button>
        </div>
      </div>
      <ResearchRunComparisonNotice comparison={history.comparison} />
      <ResearchFailedAttemptNotice attempts={history.attempts} />
      {controlsOpen && (
        <MultivariateControls draft={draft} setDraft={setDraft} rerun={rerun} running={running} />
      )}
      {runError && (
        <Alert
          className="jx-researchResult-runError"
          type="error"
          showIcon
          message={t('result.rerunFailed')}
          description={runError}
        />
      )}
      <Alert
        className="jx-researchResult-conclusion"
        type={conclusionAlertType(conclusion.level)}
        showIcon
        message={t(`result.conclusionLevel.${conclusion.level}`)}
        description={
          <div className="jx-researchResult-conclusionBody">
            <p>{zh ? conclusion.summaryZh : conclusion.summaryEn}</p>
            <div className="jx-researchResult-evidence">
              <span>
                {t('result.confidenceInterval')}: {number(conclusion.confidenceInterval95.lower)} —{' '}
                {number(conclusion.confidenceInterval95.upper)}
              </span>
              <span>
                {t('multivariate.partialRSquared')}: {percent(conclusion.effectSize.value)}
              </span>
              <span>VIF: {number(focal.varianceInflationFactor, 2)}</span>
              <span>
                {t('result.stability')}:{' '}
                {conclusion.stability.consistentFraction == null
                  ? t('result.notAssessed')
                  : percent(conclusion.stability.consistentFraction)}
              </span>
            </div>
            <ul>
              {(zh ? conclusion.limitationsZh : conclusion.limitationsEn).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        }
      />
      <div className="jx-researchResult-stats">
        <Stat label={t('result.observations')} value={String(result.observations)} />
        <Stat label={t('multivariate.focalCoefficient')} value={number(focal.estimate)} />
        <Stat label={t('result.hacT')} value={number(focal.tStatistic)} />
        <Stat label={t('multivariate.partialRSquared')} value={percent(focal.partialRSquared)} />
        <Stat label="R²" value={number(result.rSquared)} />
        <Stat label={t('multivariate.adjustedRSquared')} value={number(result.adjustedRSquared)} />
      </div>
      {run.diagnostics.length > 0 && (
        <div className="jx-researchResult-diagnostics">
          {run.diagnostics.map((diagnostic, index) => (
            <Alert
              key={`${diagnostic.code}-${index}`}
              type={diagnostic.severity === 'error' ? 'error' : diagnostic.severity}
              showIcon
              message={zh ? diagnostic.messageZh : diagnostic.messageEn}
            />
          ))}
        </div>
      )}
      <Tabs
        className="jx-researchResult-tabs"
        items={tabs}
        defaultActiveKey="coefficients"
        indicator={{ size: (origin) => origin - 4, align: 'center' }}
      />
    </Card>
  );
}

// —— 子组件 / 帮助函数 ——

function MultivariateControls({
  draft,
  setDraft,
  rerun,
  running,
}: {
  draft: MultivariateTimeSeriesPlanSpecV1;
  setDraft: React.Dispatch<React.SetStateAction<MultivariateTimeSeriesPlanSpecV1>>;
  rerun: () => Promise<void>;
  running: boolean;
}) {
  const { t } = useTranslation('research');
  return (
    <div className="jx-researchResult-controls">
      <label className="jx-researchResult-control jx-researchResult-control--wide">
        <span>{t('result.period')}</span>
        <DatePicker.RangePicker
          className="jx-researchResult-controlInput"
          allowClear={false}
          value={[parseDate(draft.start), parseDate(draft.end)]}
          onChange={(dates) => {
            if (dates?.[0] && dates[1]) {
              setDraft((current) => ({
                ...current,
                start: dates[0].format('YYYYMMDD'),
                end: dates[1].format('YYYYMMDD'),
              }));
            }
          }}
        />
      </label>
      <label className="jx-researchResult-control">
        <span>{t('result.frequency')}</span>
        <Select
          value={draft.alignment.frequency}
          options={['daily', 'monthly'].map((value) => ({ value, label: t(`frequency.${value}`) }))}
          onChange={(frequency) =>
            setDraft((current) => ({ ...current, alignment: { ...current.alignment, frequency } }))
          }
        />
      </label>
      <label className="jx-researchResult-control">
        <span>{t('result.partialPeriod')}</span>
        <Select
          value={draft.alignment.partialPeriod}
          options={['exclude', 'include'].map((value) => ({
            value,
            label: t(`partialPeriod.${value}`),
          }))}
          onChange={(partialPeriod) =>
            setDraft((current) => ({
              ...current,
              alignment: { ...current.alignment, partialPeriod },
            }))
          }
        />
      </label>
      {draft.inputs.map((input) => (
        <label key={input.id} className="jx-researchResult-control">
          <span>
            {seriesLabelFromPlan(draft, input.id)} · {t('multivariate.transform')}
          </span>
          <Select
            className="jx-researchResult-controlInput"
            value={input.transform}
            options={allowedTransforms(input.measure).map((value) => ({
              value,
              label: t(`transform.${value}`),
            }))}
            onChange={(transform) =>
              setDraft((current) => ({
                ...current,
                inputs: current.inputs.map((item) =>
                  item.id === input.id ? { ...item, transform } : item,
                ),
              }))
            }
          />
        </label>
      ))}
      {draft.protocol.predictors.map((predictor) => (
        <label key={predictor.input} className="jx-researchResult-control">
          <span>
            {seriesLabelFromPlan(draft, predictor.input)} · {t('result.lag')}
          </span>
          <InputNumber
            className="jx-researchResult-controlInput"
            value={predictor.lag}
            min={0}
            max={120}
            precision={0}
            onChange={(lag) =>
              setDraft((current) => ({
                ...current,
                protocol: {
                  ...current.protocol,
                  predictors: current.protocol.predictors.map((item) =>
                    item.input === predictor.input ? { ...item, lag: lag ?? 0 } : item,
                  ),
                },
              }))
            }
          />
        </label>
      ))}
      <label className="jx-researchResult-control">
        <span>{t('result.rollingWindow')}</span>
        <InputNumber
          className="jx-researchResult-controlInput"
          value={draft.protocol.rollingWindow ?? null}
          min={24}
          max={1200}
          precision={0}
          placeholder={t('result.disabled')}
          onChange={(rollingWindow) =>
            setDraft((current) => ({
              ...current,
              protocol: { ...current.protocol, rollingWindow: rollingWindow ?? undefined },
            }))
          }
        />
      </label>
      <label className="jx-researchResult-control">
        <span>{t('result.hacLag')}</span>
        <InputNumber
          className="jx-researchResult-controlInput"
          value={draft.protocol.inference.lag === 'automatic' ? null : draft.protocol.inference.lag}
          min={0}
          max={120}
          precision={0}
          placeholder={t('result.automatic')}
          onChange={(lag) =>
            setDraft((current) => ({
              ...current,
              protocol: {
                ...current.protocol,
                inference: { kind: 'newey_west', lag: lag ?? 'automatic' },
              },
            }))
          }
        />
      </label>
      <div className="jx-researchResult-controlActions">
        <Button
          type="primary"
          icon={<FontAwesomeIcon icon={faRotate} />}
          loading={running}
          onClick={() => void rerun()}
        >
          {t('result.rerun')}
        </Button>
      </div>
    </div>
  );
}

function CoefficientTable({ run }: { run: MultivariateTimeSeriesRunResultV1 }) {
  const { t } = useTranslation('research');
  return (
    <Table
      className="jx-researchResult-coefficientTable"
      size="small"
      rowKey="inputId"
      pagination={false}
      scroll={{ x: 820 }}
      dataSource={run.result.coefficients}
      columns={[
        {
          key: 'variable',
          title: t('multivariate.variable'),
          render: (_, item) => seriesLabel(run, item.inputId),
        },
        {
          dataIndex: 'role',
          title: t('multivariate.role'),
          render: (role) => <Tag>{t(`multivariate.${role}`)}</Tag>,
        },
        {
          dataIndex: 'estimate',
          title: t('multivariate.rawCoefficient'),
          render: (value) => number(value),
        },
        {
          key: 'interval',
          title: t('result.confidenceInterval'),
          render: (_, item) =>
            `${number(item.confidenceInterval95.lower)} — ${number(item.confidenceInterval95.upper)}`,
        },
        {
          dataIndex: 'standardizedEstimate',
          title: t('multivariate.standardizedCoefficient'),
          render: (value) => number(value),
        },
        {
          dataIndex: 'partialRSquared',
          title: t('multivariate.partialRSquared'),
          render: percent,
        },
        {
          dataIndex: 'varianceInflationFactor',
          title: 'VIF',
          render: (value) => number(value, 2),
        },
      ]}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="jx-researchResult-stat">
      <span className="jx-researchResult-statLabel">{label}</span>
      <strong className="jx-researchResult-statValue">{value}</strong>
    </div>
  );
}

function coefficientOption(run: MultivariateTimeSeriesRunResultV1, xLabel: string): ECOption {
  const labels = run.result.coefficients.map((item) => seriesLabel(run, item.inputId));
  return {
    animation: false,
    grid: { left: 150, right: 28, top: 22, bottom: 44 },
    tooltip: { trigger: 'item' },
    xAxis: {
      type: 'value',
      name: xLabel,
      nameLocation: 'middle',
      nameGap: 28,
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    yAxis: { type: 'category', data: labels, axisLabel: { color: '#59636f' } },
    series: run.result.coefficients.flatMap((item, index) => [
      {
        type: 'line' as const,
        data: [
          [item.standardizedConfidenceInterval95.lower, index],
          [item.standardizedConfidenceInterval95.upper, index],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: item.role === 'focal' ? '#e8463b' : '#59636f', width: 2 },
      },
      {
        type: 'scatter' as const,
        data: [[item.standardizedEstimate, index]],
        symbolSize: item.role === 'focal' ? 12 : 9,
        itemStyle: { color: item.role === 'focal' ? '#e8463b' : '#59636f' },
      },
    ]),
  } as ECOption;
}

function partialRegressionOption(
  data: Array<[number, number]>,
  slope: number,
  xLabel: string,
  yLabel: string,
): ECOption {
  const xs = data.map(([x]) => x);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return {
    animation: false,
    grid: { left: 62, right: 20, top: 22, bottom: 52 },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', scale: true, name: xLabel, nameLocation: 'middle', nameGap: 32 },
    yAxis: { type: 'value', scale: true, name: yLabel, nameLocation: 'middle', nameGap: 44 },
    series: [
      { type: 'scatter', data, symbolSize: 7, itemStyle: { color: '#59636f', opacity: 0.7 } },
      {
        type: 'line',
        data: [
          [min, slope * min],
          [max, slope * max],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: '#e8463b', width: 1.5 },
      },
    ],
  } as ECOption;
}

function correlationOption(run: MultivariateTimeSeriesRunResultV1): ECOption {
  const ids = run.plan.protocol.predictors.map((item) => item.input);
  const labels = ids.map((id) => seriesLabel(run, id));
  const data = run.result.predictorCorrelations.map((item) => [
    ids.indexOf(item.leftInputId),
    ids.indexOf(item.rightInputId),
    item.value,
  ]);
  return {
    animation: false,
    grid: { left: 120, right: 70, top: 32, bottom: 70 },
    tooltip: { position: 'top' },
    xAxis: {
      type: 'category',
      data: labels,
      splitArea: { show: true },
      axisLabel: { rotate: labels.length > 3 ? 25 : 0 },
    },
    yAxis: { type: 'category', data: labels, splitArea: { show: true } },
    visualMap: {
      min: -1,
      max: 1,
      calculable: false,
      orient: 'vertical',
      right: 4,
      top: 'middle',
      inRange: { color: ['#4c78a8', '#f7f7f7', '#e8463b'] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: { show: true, formatter: (params: any) => Number(params.value?.[2]).toFixed(2) },
      },
    ],
  } as ECOption;
}

function rollingOption(
  run: MultivariateTimeSeriesRunResultV1,
  label: string,
  lowerLabel: string,
  upperLabel: string,
): ECOption {
  const points = run.result.rolling;
  const dates = points.map((item) => formatDate(item.date));
  return {
    animation: false,
    grid: { left: 58, right: 18, top: 40, bottom: 34 },
    tooltip: { trigger: 'axis' },
    legend: { top: 4 },
    xAxis: { type: 'category', data: dates, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#f0f1f3' } } },
    series: [
      {
        name: label,
        type: 'line',
        data: points.map((item) => item.estimate),
        showSymbol: false,
        lineStyle: { color: '#e8463b', width: 2 },
      },
      {
        name: lowerLabel,
        type: 'line',
        data: points.map((item) => item.confidenceInterval95.lower),
        showSymbol: false,
        lineStyle: { color: '#9aa1aa', type: 'dashed' },
      },
      {
        name: upperLabel,
        type: 'line',
        data: points.map((item) => item.confidenceInterval95.upper),
        showSymbol: false,
        lineStyle: { color: '#9aa1aa', type: 'dashed' },
      },
    ],
  } as ECOption;
}

function seriesLabel(run: MultivariateTimeSeriesRunResultV1, inputId: string) {
  return seriesLabelFromPlan(run.plan, inputId);
}
function seriesLabelFromPlan(plan: MultivariateTimeSeriesPlanSpecV1, inputId: string) {
  const input = plan.inputs.find((item) => item.id === inputId);
  return input?.label ?? input?.id ?? inputId;
}
function allowedTransforms(measure: string): ResearchTransformV1[] {
  if (measure === 'macro.observation') {
    return ['level', 'difference', 'percent_change', 'year_over_year'];
  }
  if (measure === 'rates.yield_pct') {
    return ['level', 'difference', 'percent_change'];
  }
  return ['level', 'difference', 'simple_return', 'percent_change'];
}
function conclusionAlertType(
  level: MultivariateTimeSeriesRunResultV1['conclusion']['level'],
): 'success' | 'warning' | 'info' | 'error' {
  return level === 'supports'
    ? 'success'
    : level === 'weak_support'
      ? 'warning'
      : level === 'indeterminate'
        ? 'error'
        : 'info';
}
function number(value: number | null, digits = 4) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}
function percent(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
}
function parseDate(value: string) {
  return dayjs(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`);
}
function formatDate(value: string) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value || '—';
}
