import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  InputNumber,
  Select,
  Tabs,
  Tag,
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ResearchPart,
  ResearchRollingRelationshipPointV1,
  ResearchSeriesInputSpecV1,
  ResearchTransformV1,
  TimeSeriesRelationshipConclusionV1,
  TimeSeriesRelationshipPlanSpecV1,
  TimeSeriesRelationshipRunResultV1,
} from '@jixie/shared';
import {
  faCode,
  faFlask,
  faRotate,
  faSliders,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { DistributionComparisonCard } from './distribution-comparison-card';
import { EventStudyCard } from './event-study-card';
import { EChart, type ECOption } from './echart';
import { Markdown } from './markdown';
import { MultivariateTimeSeriesCard } from './multivariate-time-series-card';
import { ResearchFormulae } from './research-formulae';
import {
  ResearchFailedAttemptNotice,
  ResearchFingerprintDetails,
  ResearchRunComparisonNotice,
  ResearchRunHistorySelect,
  useResearchRunHistory,
} from './research-run-history';
import './research-result-card.css';

interface ResearchResultCardProps {
  part: ResearchPart;
}

type TimeSeriesResearchPart = Omit<ResearchPart, 'run'> & {
  run: TimeSeriesRelationshipRunResultV1;
};

/** A deterministic ResearchRun rendered beside the model's prose. Values, formulae and code all
 * come from the validated protocol result; the LLM cannot invent or mutate this payload. */
export function ResearchResultCard({ part }: ResearchResultCardProps) {
  if (part.run.result.kind === 'multivariate_time_series_relationship') {
    return (
      <MultivariateTimeSeriesCard title={part.title} run={part.run as never} record={part.record} />
    );
  }
  if (part.run.result.kind === 'distribution_comparison') {
    return (
      <DistributionComparisonCard title={part.title} run={part.run as never} record={part.record} />
    );
  }
  if (part.run.result.kind === 'event_study') {
    return <EventStudyCard title={part.title} run={part.run as never} record={part.record} />;
  }
  return <TimeSeriesResultCard part={part as TimeSeriesResearchPart} />;
}

function TimeSeriesResultCard({ part }: { part: TimeSeriesResearchPart }) {
  const { t, i18n } = useTranslation('research');
  const history = useResearchRunHistory(part.run, part.record);
  const run = history.run;
  const [draft, setDraft] = useState(() => editablePlan(part.run));
  const [controlsOpen, setControlsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const relationship = run.result;
  const regression = relationship.regression;
  const conclusion = (
    run as TimeSeriesRelationshipRunResultV1 & {
      conclusion?: TimeSeriesRelationshipConclusionV1;
    }
  ).conclusion;
  const zh = i18n.language.startsWith('zh');
  const predictor = run.plan.inputs.find((input) => input.id === run.plan.protocol.predictor);
  const outcome = run.plan.inputs.find((input) => input.id === run.plan.protocol.outcome);

  useEffect(() => {
    setDraft(editablePlan(run));
    setControlsOpen(false);
    setRunError('');
  }, [run]);

  const rerun = async () => {
    setRunning(true);
    setRunError('');
    try {
      const next = await history.rerun(draft);
      setDraft(editablePlan(next));
      setControlsOpen(false);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t('result.rerunFailed'));
    } finally {
      setRunning(false);
    }
  };

  const tabs = [
    {
      key: 'scatter',
      label: t('result.scatter'),
      children: (
        <EChart
          className="jx-researchResult-chart"
          option={scatterOption(
            relationship.points.map((point) => [point.predictor, point.outcome]),
            regression.intercept,
            regression.slope,
            predictor?.label ?? predictor?.id ?? t('result.predictor'),
            outcome?.label ?? outcome?.id ?? t('result.outcome'),
          )}
        />
      ),
    },
    ...(relationship.rolling.length > 0
      ? [
          {
            key: 'rolling',
            label: t('result.rolling'),
            children: (
              <EChart
                className="jx-researchResult-chart"
                option={rollingOption(relationship.rolling, t('result.pearson'), t('result.slope'))}
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
              <h4>{item.inputId}</h4>
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 2 }}
                items={[
                  {
                    key: 'loaded',
                    label: t('result.observationsLoaded'),
                    children: String(item.observationsLoaded),
                  },
                  {
                    key: 'aligned',
                    label: t('result.observationsAligned'),
                    children: String(item.observationsAligned),
                  },
                  {
                    key: 'range',
                    label: t('result.actualRange'),
                    children: `${formatDate(item.firstDate ?? '')} — ${formatDate(item.lastDate ?? '')}`,
                  },
                  {
                    key: 'missing',
                    label: t('result.missingAfterAlignment'),
                    children: String(item.missingAfterAlignment),
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
              {
                key: 'question',
                label: t('result.question'),
                children: questionText(run),
              },
              {
                key: 'hypothesis',
                label: t('result.hypothesis'),
                children: hypothesisDescription(run, t),
              },
              {
                key: 'period',
                label: t('result.period'),
                children: `${formatDate(run.plan.start)} — ${formatDate(run.plan.end)}`,
              },
              {
                key: 'frequency',
                label: t('result.frequency'),
                children: t(`frequency.${run.plan.alignment.frequency}`),
              },
              {
                key: 'partialPeriod',
                label: t('result.partialPeriod'),
                children: t(`partialPeriod.${run.plan.alignment.partialPeriod}`),
              },
              {
                key: 'predictor',
                label: t('result.predictor'),
                children: seriesDescription(predictor, t),
              },
              {
                key: 'outcome',
                label: t('result.outcome'),
                children: seriesDescription(outcome, t),
              },
              {
                key: 'lag',
                label: t('result.lag'),
                children: String(run.plan.protocol.predictorLag),
              },
              {
                key: 'hac',
                label: t('result.hacLag'),
                children: String(regression.neweyWestLag),
              },
            ]}
          />

          {(run.protocol.assumptions ?? []).length > 0 && (
            <MethodList title={t('result.assumptions')} items={run.protocol.assumptions} zh={zh} />
          )}
          {(run.protocol.terminology ?? []).length > 0 && (
            <MethodList title={t('result.terminology')} items={run.protocol.terminology} zh={zh} />
          )}

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
          <span>{part.title}</span>
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
          <ControlSelect
            label={t('result.frequency')}
            value={draft.alignment.frequency}
            options={(['daily', 'monthly'] as const).map((value) => ({
              value,
              label: t(`frequency.${value}`),
            }))}
            onChange={(frequency) =>
              setDraft((current) => ({
                ...current,
                alignment: { ...current.alignment, frequency },
              }))
            }
          />
          <ControlSelect
            label={t('result.partialPeriod')}
            value={draft.alignment.partialPeriod}
            options={(['exclude', 'include'] as const).map((value) => ({
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
          <TransformControl
            label={t('result.predictorTransform')}
            input={draft.inputs.find((input) => input.id === draft.protocol.predictor)}
            t={t}
            onChange={(transform) =>
              setDraft((current) =>
                replaceTransform(current, current.protocol.predictor, transform),
              )
            }
          />
          <TransformControl
            label={t('result.outcomeTransform')}
            input={draft.inputs.find((input) => input.id === draft.protocol.outcome)}
            t={t}
            onChange={(transform) =>
              setDraft((current) => replaceTransform(current, current.protocol.outcome, transform))
            }
          />
          <ControlNumber
            label={t('result.lag')}
            value={draft.protocol.predictorLag}
            min={0}
            max={120}
            onChange={(predictorLag) =>
              setDraft((current) => ({
                ...current,
                protocol: { ...current.protocol, predictorLag },
              }))
            }
          />
          <ControlNumber
            label={t('result.rollingWindow')}
            value={draft.protocol.rollingWindow ?? null}
            min={12}
            max={1200}
            placeholder={t('result.disabled')}
            onChange={(rollingWindow) =>
              setDraft((current) => ({
                ...current,
                protocol: {
                  ...current.protocol,
                  ...(rollingWindow == null ? { rollingWindow: undefined } : { rollingWindow }),
                },
              }))
            }
          />
          <ControlNumber
            label={t('result.hacLag')}
            value={
              draft.protocol.inference.lag === 'automatic' ? null : draft.protocol.inference.lag
            }
            min={0}
            max={120}
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
      )}

      {runError && (
        <Alert
          className="jx-researchResult-runError"
          type="error"
          showIcon
          title={t('result.rerunFailed')}
          description={runError}
        />
      )}

      {conclusion ? (
        <Alert
          className="jx-researchResult-conclusion"
          type={conclusionAlertType(conclusion.level)}
          showIcon
          title={t(`result.conclusionLevel.${conclusion.level}`)}
          description={
            <div className="jx-researchResult-conclusionBody">
              <p>{zh ? conclusion.summaryZh : conclusion.summaryEn}</p>
              <div className="jx-researchResult-evidence">
                <span>
                  {t('result.confidenceInterval')}: {number(conclusion.confidenceInterval95.lower)}{' '}
                  — {number(conclusion.confidenceInterval95.upper)}
                </span>
                <span>
                  {t('result.effectSize')}:{' '}
                  {t(`result.effectMagnitude.${conclusion.effectSize.magnitude}`)}
                  {' · '}
                  {number(conclusion.effectSize.value)}
                </span>
                <span>
                  {t('result.stability')}:{' '}
                  {conclusion.stability.consistentFraction == null
                    ? t('result.notAssessed')
                    : `${(conclusion.stability.consistentFraction * 100).toFixed(1)}%`}
                </span>
              </div>
              <ul>
                {(zh ? conclusion.limitationsZh : conclusion.limitationsEn).map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          }
        />
      ) : (
        <Alert
          className="jx-researchResult-conclusion"
          type="info"
          showIcon
          title={t('result.legacyConclusion')}
        />
      )}

      <div className="jx-researchResult-stats">
        <Stat label={t('result.observations')} value={String(relationship.observations)} />
        <Stat label={t('result.pearson')} value={number(relationship.pearson)} />
        <Stat label={t('result.spearman')} value={number(relationship.spearman)} />
        <Stat label={t('result.slope')} value={number(regression.slope)} />
        <Stat label={t('result.hacT')} value={number(regression.slopeTStatistic)} />
        <Stat label="R²" value={number(regression.rSquared)} />
      </div>

      {run.diagnostics.length > 0 && (
        <div className="jx-researchResult-diagnostics">
          {run.diagnostics.map((diagnostic, index) => (
            <Alert
              key={`${diagnostic.code}-${index}`}
              type={diagnostic.severity === 'error' ? 'error' : diagnostic.severity}
              showIcon
              title={zh ? diagnostic.messageZh : diagnostic.messageEn}
            />
          ))}
        </div>
      )}

      <Tabs
        className="jx-researchResult-tabs"
        items={tabs}
        defaultActiveKey="scatter"
        indicator={{ size: (origin) => origin - 4, align: 'center' }}
      />
    </Card>
  );
}

// —— 子组件 / 帮助函数 ——

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="jx-researchResult-stat">
      <span className="jx-researchResult-statLabel">{label}</span>
      <strong className="jx-researchResult-statValue">{value}</strong>
    </div>
  );
}

function ControlSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="jx-researchResult-control">
      <span>{label}</span>
      <Select
        className="jx-researchResult-controlInput"
        value={value}
        options={options}
        onChange={onChange}
      />
    </label>
  );
}

function ControlNumber({
  label,
  value,
  min,
  max,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="jx-researchResult-control">
      <span>{label}</span>
      <InputNumber
        className="jx-researchResult-controlInput"
        value={value}
        min={min}
        max={max}
        precision={0}
        placeholder={placeholder}
        onChange={onChange}
      />
    </label>
  );
}

function TransformControl({
  label,
  input,
  t,
  onChange,
}: {
  label: string;
  input: ResearchSeriesInputSpecV1 | undefined;
  t: ReturnType<typeof useTranslation<'research'>>['t'];
  onChange: (value: ResearchTransformV1) => void;
}) {
  if (!input) {
    return null;
  }
  return (
    <ControlSelect
      label={label}
      value={input.transform}
      options={allowedTransforms(input.measure).map((value) => ({
        value,
        label: t(`transform.${value}`),
      }))}
      onChange={onChange}
    />
  );
}

function MethodList({
  title,
  items,
  zh,
}: {
  title: string;
  items: Array<{
    id: string;
    labelZh: string;
    labelEn: string;
    descriptionZh: string;
    descriptionEn: string;
  }>;
  zh: boolean;
}) {
  return (
    <section className="jx-researchResult-methodList">
      <h4>{title}</h4>
      <dl>
        {items.map((item) => (
          <div key={item.id}>
            <dt>{zh ? item.labelZh : item.labelEn}</dt>
            <dd>{zh ? item.descriptionZh : item.descriptionEn}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function editablePlan(run: TimeSeriesRelationshipRunResultV1): TimeSeriesRelationshipPlanSpecV1 {
  const raw = structuredClone(run.plan) as TimeSeriesRelationshipPlanSpecV1 & {
    question: unknown;
  };
  const question = raw.question;
  if (typeof question !== 'string') {
    return raw;
  }
  return {
    ...raw,
    question: {
      version: 1,
      kind: 'time_series_relationship',
      text: question,
      hypothesis: { estimand: 'regression_slope', direction: 'two_sided', nullValue: 0 },
    },
    outputs: [
      ...raw.outputs.filter((output) => output.kind !== 'conclusion'),
      { kind: 'conclusion' },
    ],
  };
}

function replaceTransform(
  plan: TimeSeriesRelationshipPlanSpecV1,
  inputId: string,
  transform: ResearchTransformV1,
): TimeSeriesRelationshipPlanSpecV1 {
  return {
    ...plan,
    inputs: plan.inputs.map((input) => (input.id === inputId ? { ...input, transform } : input)),
  };
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

function questionText(run: TimeSeriesRelationshipRunResultV1): string {
  const question = run.plan.question as unknown;
  return typeof question === 'string' ? question : run.plan.question.text;
}

function hypothesisDescription(
  run: TimeSeriesRelationshipRunResultV1,
  t: ReturnType<typeof useTranslation<'research'>>['t'],
): string {
  const question = run.plan.question as unknown;
  if (typeof question === 'string') {
    return t('result.legacyHypothesis');
  }
  return t(`result.hypothesisDirection.${run.plan.question.hypothesis.direction}`);
}

function conclusionAlertType(
  level: TimeSeriesRelationshipConclusionV1['level'],
): 'success' | 'warning' | 'info' | 'error' {
  if (level === 'supports') {
    return 'success';
  }
  if (level === 'weak_support') {
    return 'warning';
  }
  return level === 'indeterminate' ? 'error' : 'info';
}

function number(value: number | null, digits = 4): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function parseDate(value: string) {
  return dayjs(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`);
}

function formatDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value || '—';
}

function seriesDescription(
  input: TimeSeriesRelationshipPlanSpecV1['inputs'][number] | undefined,
  t: ReturnType<typeof useTranslation<'research'>>['t'],
): string {
  if (!input) {
    return '—';
  }
  const source = input.source;
  let identifier: string;
  if (source.kind === 'instrument') {
    identifier = `${source.assetType}:${source.id}`;
  } else if (source.kind === 'macro') {
    identifier = source.seriesKey;
  } else if (source.kind === 'fx') {
    identifier = source.id;
  } else {
    identifier = `${source.curveCode}/${source.curveType}/${source.termYears}Y`;
  }
  return `${input.label ?? input.id} · ${identifier} · ${t(`transform.${input.transform}`)}`;
}

function scatterOption(
  data: Array<[number, number]>,
  intercept: number,
  slope: number,
  predictorLabel: string,
  outcomeLabel: string,
): ECOption {
  const xs = data.map(([x]) => x);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return {
    animation: false,
    grid: { left: 58, right: 18, top: 22, bottom: 48 },
    tooltip: { trigger: 'item' },
    xAxis: {
      type: 'value',
      scale: true,
      name: predictorLabel,
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: { color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: outcomeLabel,
      nameLocation: 'middle',
      nameGap: 40,
      axisLabel: { color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      { type: 'scatter', data, symbolSize: 7, itemStyle: { color: '#59636f', opacity: 0.72 } },
      {
        type: 'line',
        data: [
          [min, intercept + slope * min],
          [max, intercept + slope * max],
        ],
        showSymbol: false,
        silent: true,
        lineStyle: { color: '#e8463b', width: 1.5 },
      },
    ],
  } as ECOption;
}

function rollingOption(
  points: ResearchRollingRelationshipPointV1[],
  pearsonLabel: string,
  slopeLabel: string,
): ECOption {
  return {
    animation: false,
    grid: { left: 52, right: 52, top: 42, bottom: 30 },
    tooltip: { trigger: 'axis' },
    legend: { top: 4, textStyle: { color: '#8a9099' } },
    xAxis: {
      type: 'category',
      data: points.map((point) => formatDate(point.date)),
      axisLabel: { color: '#8a9099', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: [
      {
        type: 'value',
        min: -1,
        max: 1,
        axisLabel: { color: '#8a9099' },
        splitLine: { lineStyle: { color: '#f0f1f3' } },
      },
      {
        type: 'value',
        scale: true,
        axisLabel: { color: '#8a9099' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: pearsonLabel,
        type: 'line',
        data: points.map((point) => point.pearson),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: '#59636f', width: 1.5 },
      },
      {
        name: slopeLabel,
        type: 'line',
        yAxisIndex: 1,
        data: points.map((point) => point.slope),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: '#e8463b', width: 1.5 },
      },
    ],
  } as ECOption;
}
