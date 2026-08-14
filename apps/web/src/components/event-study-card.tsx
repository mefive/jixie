import { Alert, Button, Card, Descriptions, InputNumber, Table, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EventStudyConclusionV1,
  EventStudyRunResultV1,
  ResearchRunRecordRefV1,
  ResearchConclusionLevelV1,
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
import {
  ResearchFailedAttemptNotice,
  ResearchFingerprintDetails,
  ResearchRunComparisonNotice,
  ResearchRunHistorySelect,
  useResearchRunHistory,
} from './research-run-history';
import './event-study-card.css';

interface EventStudyCardProps {
  title: string;
  run: EventStudyRunResultV1;
  record?: ResearchRunRecordRefV1;
}

/** Render the event-time path and event-level sample selection from a deterministic event study. */
export function EventStudyCard({
  title,
  run: initialRun,
  record: initialRecord,
}: EventStudyCardProps) {
  const { t, i18n } = useTranslation('research');
  const history = useResearchRunHistory(initialRun, initialRecord);
  const run = history.run;
  const [draft, setDraft] = useState(() => structuredClone(initialRun.plan));
  const [controlsOpen, setControlsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const zh = i18n.language.startsWith('zh');
  const result = run.result;
  const aggregate = result.aggregate;
  const [eventCoverage, benchmarkCoverage] = run.coverage;
  const benchmarkInput = run.plan.inputs[1];

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
      key: 'path',
      label: t('event.path'),
      children: (
        <EChart
          className="jx-eventStudy-chart"
          option={eventPathOption(run, t('event.caar'), t('event.lower95'), t('event.upper95'))}
        />
      ),
    },
    {
      key: 'events',
      label: t('event.eventSample'),
      children: (
        <Table
          className="jx-eventStudy-table"
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          rowKey="id"
          dataSource={result.events}
          columns={[
            {
              title: t('event.entity'),
              dataIndex: ['entity', 'id'],
            },
            {
              title: t('event.announcementDate'),
              dataIndex: 'announcementDate',
              render: (value: string) => formatDate(value),
            },
            {
              title: t('event.eventTradeDate'),
              dataIndex: 'eventTradeDate',
              render: (value: string) => formatDate(value),
            },
            {
              title: t('event.reportPeriod'),
              dataIndex: 'reportPeriod',
              render: (value: string) => formatDate(value),
            },
            {
              title: 'CAR',
              dataIndex: 'cumulativeAbnormalReturn',
              render: (value: number) => percentage(value),
            },
          ]}
          scroll={{ x: 700 }}
        />
      ),
    },
    {
      key: 'selection',
      label: t('event.sampleSelection'),
      children: (
        <div className="jx-eventStudy-selection">
          <section className="jx-eventStudy-selectionItem">
            <h4>{t('event.events')}</h4>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                {
                  key: 'entities',
                  label: t('event.entitiesRequested'),
                  children: String(eventCoverage.entitiesRequested),
                },
                {
                  key: 'loaded',
                  label: t('event.eventsLoaded'),
                  children: String(eventCoverage.eventsLoaded),
                },
                {
                  key: 'complete',
                  label: t('event.completeWindows'),
                  children: String(eventCoverage.eventsWithCompleteWindow),
                },
                {
                  key: 'overlap',
                  label: t('event.overlapsExcluded'),
                  children: String(eventCoverage.overlappingEventsExcluded),
                },
                {
                  key: 'analyzed',
                  label: t('event.eventsAnalyzed'),
                  children: String(eventCoverage.eventsAnalyzed),
                },
                {
                  key: 'range',
                  label: t('event.eventDateRange'),
                  children: `${formatDate(eventCoverage.firstEventDate ?? '')} — ${formatDate(eventCoverage.lastEventDate ?? '')}`,
                },
              ]}
            />
          </section>
          <section className="jx-eventStudy-selectionItem">
            <h4>{t('event.benchmark')}</h4>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: 'benchmark',
                  label: t('event.benchmark'),
                  children: benchmarkDescription(benchmarkInput),
                },
                {
                  key: 'loaded',
                  label: t('result.observationsLoaded'),
                  children: String(benchmarkCoverage.observationsLoaded),
                },
                {
                  key: 'range',
                  label: t('result.actualRange'),
                  children: `${formatDate(benchmarkCoverage.firstDate ?? '')} — ${formatDate(benchmarkCoverage.lastDate ?? '')}`,
                },
              ]}
            />
          </section>
        </div>
      ),
    },
    {
      key: 'sensitivity',
      label: t('distribution.sensitivity'),
      children: (
        <div className="jx-eventStudy-sensitivity">
          <EChart
            className="jx-eventStudy-sensitivityChart"
            option={sensitivityOption(
              aggregate.meanCumulativeAbnormalReturn,
              aggregate.winsorizedMeanCumulativeAbnormalReturn,
              t('event.meanCar'),
              t('event.winsorizedMeanCar'),
            )}
          />
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={[
              {
                key: 'positiveFraction',
                label: t('event.positiveFraction'),
                children: percentage(aggregate.positiveFraction),
              },
              {
                key: 'robustness',
                label: t('distribution.robustness'),
                children: t(`distribution.robustnessLevel.${run.conclusion.robustness.assessment}`),
              },
            ]}
          />
        </div>
      ),
    },
    {
      key: 'method',
      label: t('result.method'),
      children: (
        <div className="jx-eventStudy-method">
          <Descriptions
            size="small"
            column={1}
            items={[
              { key: 'question', label: t('result.question'), children: run.plan.question.text },
              {
                key: 'hypothesis',
                label: t('result.hypothesis'),
                children: t(`event.hypothesisDirection.${run.plan.question.hypothesis.direction}`),
              },
              {
                key: 'period',
                label: t('result.period'),
                children: `${formatDate(run.plan.start)} — ${formatDate(run.plan.end)}`,
              },
              {
                key: 'window',
                label: t('event.eventWindow'),
                children: `[${result.eventWindow.start}, ${result.eventWindow.end}]`,
              },
              {
                key: 'model',
                label: t('event.returnModel'),
                children: t('event.marketAdjusted'),
              },
            ]}
          />
          <MethodList title={t('result.assumptions')} items={run.protocol.assumptions} zh={zh} />
          <MethodList title={t('result.terminology')} items={run.protocol.terminology} zh={zh} />
          <div className="jx-eventStudy-formulae">
            {run.protocol.formulae.map((formula) => (
              <section key={formula.id} className="jx-eventStudy-formula">
                <h4>{zh ? formula.labelZh : formula.labelEn}</h4>
                <Markdown text={`$$${formula.latex}$$`} />
              </section>
            ))}
          </div>
          <ResearchFingerprintDetails run={run} />
          <section className="jx-eventStudy-code">
            <h4>
              <FontAwesomeIcon icon={faCode} /> {t('result.pythonExample')}
            </h4>
            <Markdown text={`\`\`\`python\n${run.protocol.pythonExample}\n\`\`\``} />
          </section>
          <div className="jx-eventStudy-docs">
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
    <Card className="jx-eventStudy" size="small">
      <div className="jx-eventStudy-head">
        <div className="jx-eventStudy-title">
          <FontAwesomeIcon icon={faFlask} />
          <span>{title}</span>
        </div>
        <div className="jx-eventStudy-actions">
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
        <div className="jx-eventStudy-controls">
          <label className="jx-eventStudy-control">
            <span>{t('event.windowStart')}</span>
            <InputNumber
              className="jx-eventStudy-controlInput"
              min={-60}
              max={0}
              precision={0}
              value={draft.protocol.eventWindow.start}
              onChange={(start) =>
                setDraft((current) => ({
                  ...current,
                  protocol: {
                    ...current.protocol,
                    eventWindow: { ...current.protocol.eventWindow, start: start ?? -5 },
                  },
                }))
              }
            />
          </label>
          <label className="jx-eventStudy-control">
            <span>{t('event.windowEnd')}</span>
            <InputNumber
              className="jx-eventStudy-controlInput"
              min={0}
              max={60}
              precision={0}
              value={draft.protocol.eventWindow.end}
              onChange={(end) =>
                setDraft((current) => ({
                  ...current,
                  protocol: {
                    ...current.protocol,
                    eventWindow: { ...current.protocol.eventWindow, end: end ?? 5 },
                  },
                }))
              }
            />
          </label>
          <Button
            type="primary"
            icon={<FontAwesomeIcon icon={faRotate} />}
            loading={running}
            onClick={() => void rerun()}
          >
            {t('result.rerun')}
          </Button>
        </div>
      )}

      {runError && (
        <Alert
          className="jx-eventStudy-runError"
          type="error"
          showIcon
          message={t('result.rerunFailed')}
          description={runError}
        />
      )}

      <Conclusion conclusion={run.conclusion} zh={zh} />

      <div className="jx-eventStudy-stats">
        <Stat label={t('event.eventsAnalyzed')} value={String(result.observations)} />
        <Stat label={t('event.eventDateClusters')} value={String(aggregate.eventDateClusters)} />
        <Stat
          label={t('event.meanCar')}
          value={percentage(aggregate.meanCumulativeAbnormalReturn)}
        />
        <Stat
          label={t('event.medianCar')}
          value={percentage(aggregate.medianCumulativeAbnormalReturn)}
        />
        <Stat label={t('event.tStatistic')} value={number(aggregate.tStatistic)} />
        <Stat label={t('event.positiveFraction')} value={percentage(aggregate.positiveFraction)} />
      </div>

      {run.diagnostics.length > 0 && (
        <div className="jx-eventStudy-diagnostics">
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
        className="jx-eventStudy-tabs"
        items={tabs}
        defaultActiveKey="path"
        indicator={{ size: (origin) => origin - 4, align: 'center' }}
      />
    </Card>
  );
}

// —— 子组件 / 帮助函数 ——

function Conclusion({ conclusion, zh }: { conclusion: EventStudyConclusionV1; zh: boolean }) {
  const { t } = useTranslation('research');
  return (
    <Alert
      className="jx-eventStudy-conclusion"
      type={conclusionAlertType(conclusion.level)}
      showIcon
      message={t(`result.conclusionLevel.${conclusion.level}`)}
      description={
        <div className="jx-eventStudy-conclusionBody">
          <p>{zh ? conclusion.summaryZh : conclusion.summaryEn}</p>
          <div className="jx-eventStudy-evidence">
            <span>
              {t('result.confidenceInterval')}: {percentage(conclusion.confidenceInterval95.lower)}{' '}
              — {percentage(conclusion.confidenceInterval95.upper)}
            </span>
            <span>
              {t('result.effectSize')}:{' '}
              {t(`result.effectMagnitude.${conclusion.effectSize.magnitude}`)}
              {' · '}
              {number(conclusion.effectSize.value)}
            </span>
            <span>
              {t('distribution.robustness')}:{' '}
              {t(`distribution.robustnessLevel.${conclusion.robustness.assessment}`)}
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
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="jx-eventStudy-stat">
      <span className="jx-eventStudy-statLabel">{label}</span>
      <strong className="jx-eventStudy-statValue">{value}</strong>
    </div>
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
    <section className="jx-eventStudy-methodList">
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

function conclusionAlertType(
  level: ResearchConclusionLevelV1,
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

function percentage(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
}

function formatDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value || '—';
}

function benchmarkDescription(input: EventStudyRunResultV1['plan']['inputs'][1]): string {
  const source = input.source;
  return source.kind === 'instrument'
    ? `${input.label ?? input.id} · ${source.assetType}:${source.id}`
    : (input.label ?? input.id);
}

function eventPathOption(
  run: EventStudyRunResultV1,
  caarLabel: string,
  lowerLabel: string,
  upperLabel: string,
): ECOption {
  const points = run.result.path;
  return {
    animation: false,
    grid: { left: 64, right: 24, top: 24, bottom: 46 },
    tooltip: { trigger: 'axis', valueFormatter: (value) => percentage(Number(value)) },
    xAxis: {
      type: 'category',
      data: points.map((point) => String(point.relativeDay)),
      axisLabel: { color: '#8a9099' },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#8a9099', formatter: (value: number) => `${(value * 100).toFixed(1)}%` },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        name: caarLabel,
        type: 'line',
        data: points.map((point) => point.cumulativeAverageAbnormalReturn),
        showSymbol: true,
        lineStyle: { color: '#e8463b', width: 2 },
        itemStyle: { color: '#e8463b' },
      },
      {
        name: lowerLabel,
        type: 'line',
        data: points.map((point) => point.cumulativeConfidenceInterval95.lower),
        showSymbol: false,
        silent: true,
        lineStyle: { color: '#9aa1aa', width: 1, type: 'dashed' },
      },
      {
        name: upperLabel,
        type: 'line',
        data: points.map((point) => point.cumulativeConfidenceInterval95.upper),
        showSymbol: false,
        silent: true,
        lineStyle: { color: '#9aa1aa', width: 1, type: 'dashed' },
      },
    ],
  } as ECOption;
}

function sensitivityOption(
  raw: number,
  winsorized: number,
  rawLabel: string,
  winsorizedLabel: string,
): ECOption {
  return {
    animation: false,
    grid: { left: 64, right: 24, top: 20, bottom: 56 },
    tooltip: { trigger: 'axis', valueFormatter: (value) => percentage(Number(value)) },
    xAxis: {
      type: 'category',
      data: [rawLabel, winsorizedLabel],
      axisLabel: { color: '#8a9099', interval: 0 },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#8a9099', formatter: (value: number) => `${(value * 100).toFixed(1)}%` },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        type: 'bar',
        data: [raw, winsorized],
        barMaxWidth: 72,
        itemStyle: { color: '#59636f' },
      },
    ],
  } as ECOption;
}
