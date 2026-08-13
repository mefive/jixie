import { Alert, Card, Descriptions, Tabs, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ResearchPart, ResearchRollingRelationshipPointV1 } from '@jixie/shared';
import { faCode, faFlask, faSquareRootVariable } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { EChart, type ECOption } from './echart';
import { Markdown } from './markdown';
import './research-result-card.css';

interface ResearchResultCardProps {
  part: ResearchPart;
}

/** A deterministic ResearchRun rendered beside the model's prose. Values, formulae and code all
 * come from the validated protocol result; the LLM cannot invent or mutate this payload. */
export function ResearchResultCard({ part }: ResearchResultCardProps) {
  const { t, i18n } = useTranslation('research');
  const run = part.run;
  const relationship = run.result;
  const regression = relationship.regression;
  const zh = i18n.language.startsWith('zh');
  const predictor = run.plan.inputs.find((input) => input.id === run.plan.protocol.predictor);
  const outcome = run.plan.inputs.find((input) => input.id === run.plan.protocol.outcome);

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
      key: 'method',
      label: t('result.method'),
      children: (
        <div className="jx-researchResult-method">
          <Descriptions
            size="small"
            column={1}
            items={[
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

          <div className="jx-researchResult-formulae">
            {run.protocol.formulae.map((formula) => (
              <section key={formula.id} className="jx-researchResult-formula">
                <h4>{zh ? formula.labelZh : formula.labelEn}</h4>
                <Markdown text={`$$${formula.latex}$$`} />
              </section>
            ))}
          </div>

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
        <Tag>{zh ? run.protocol.nameZh : run.protocol.nameEn}</Tag>
      </div>

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
              message={zh ? diagnostic.messageZh : diagnostic.messageEn}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="jx-researchResult-stat">
      <span className="jx-researchResult-statLabel">{label}</span>
      <strong className="jx-researchResult-statValue">{value}</strong>
    </div>
  );
}

function number(value: number | null, digits = 4): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function formatDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
}

function seriesDescription(
  input: ResearchPart['run']['plan']['inputs'][number] | undefined,
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
