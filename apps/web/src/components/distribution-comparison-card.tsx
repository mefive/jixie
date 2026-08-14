import { Alert, Button, Card, Descriptions, InputNumber, Table, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DistributionComparisonConclusionV1,
  DistributionComparisonRunResultV1,
  ResearchRunRecordRefV1,
  ResearchDistributionSummaryV1,
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
  ResearchRunComparisonNotice,
  ResearchFingerprintDetails,
  ResearchRunHistorySelect,
  useResearchRunHistory,
} from './research-run-history';
import './distribution-comparison-card.css';

interface DistributionComparisonCardProps {
  title: string;
  run: DistributionComparisonRunResultV1;
  record?: ResearchRunRecordRefV1;
}

type DistributionSummaryRow = ResearchDistributionSummaryV1 & {
  key: string;
  group: string;
};

/** Render a deterministic two-group comparison including uncertainty, rank evidence, effect size,
 * and an explicit outlier-sensitivity result. */
export function DistributionComparisonCard({
  title,
  run: initialRun,
  record: initialRecord,
}: DistributionComparisonCardProps) {
  const { t, i18n } = useTranslation('research');
  const history = useResearchRunHistory(initialRun, initialRecord);
  const run = history.run;
  const [draft, setDraft] = useState(() => structuredClone(initialRun.plan));
  const [controlsOpen, setControlsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const zh = i18n.language.startsWith('zh');
  const result = run.result;
  const comparison = result.comparison;
  const [groupA, groupB] = result.groups;

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
      key: 'distribution',
      label: t('distribution.boxplot'),
      children: (
        <EChart
          className="jx-distributionComparison-chart"
          option={boxplotOption(result.groups, t('distribution.value'))}
        />
      ),
    },
    {
      key: 'summary',
      label: t('distribution.summary'),
      children: (
        <Table<DistributionSummaryRow>
          className="jx-distributionComparison-table"
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={result.groups.map((group) => ({
            key: group.inputId,
            group: group.label,
            ...group.summary,
          }))}
          columns={[
            { title: t('distribution.group'), dataIndex: 'group' },
            { title: t('distribution.count'), dataIndex: 'count' },
            {
              title: t('distribution.mean'),
              dataIndex: 'mean',
              render: (value: number) => number(value),
            },
            {
              title: t('distribution.median'),
              dataIndex: 'median',
              render: (value: number) => number(value),
            },
            {
              title: t('distribution.standardDeviation'),
              dataIndex: 'standardDeviation',
              render: (value: number) => number(value),
            },
            {
              title: t('distribution.winsorizedMean'),
              dataIndex: 'winsorizedMean',
              render: (value: number) => number(value),
            },
          ]}
          scroll={{ x: 720 }}
        />
      ),
    },
    {
      key: 'sensitivity',
      label: t('distribution.sensitivity'),
      children: (
        <div className="jx-distributionComparison-sensitivity">
          <EChart
            className="jx-distributionComparison-sensitivityChart"
            option={sensitivityOption(
              comparison.meanDifference,
              comparison.winsorizedMeanDifference,
              t('distribution.rawMeanDifference'),
              t('distribution.winsorizedMeanDifference'),
            )}
          />
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2 }}
            items={[
              {
                key: 'tailFraction',
                label: t('distribution.tailFraction'),
                children: `${(run.plan.protocol.sensitivity.tailFraction * 100).toFixed(1)}%`,
              },
              {
                key: 'robustness',
                label: t('distribution.robustness'),
                children: t(`distribution.robustnessLevel.${run.conclusion.robustness.assessment}`),
              },
              {
                key: 'rankP',
                label: t('distribution.mannWhitneyP'),
                children: number(comparison.mannWhitneyTwoSidedPApprox),
              },
              {
                key: 'cliffsDelta',
                label: t('distribution.cliffsDelta'),
                children: number(comparison.cliffsDelta),
              },
            ]}
          />
        </div>
      ),
    },
    {
      key: 'coverage',
      label: t('result.coverage'),
      children: (
        <div className="jx-distributionComparison-coverage">
          {run.coverage.map((item) => (
            <section key={item.inputId} className="jx-distributionComparison-coverageItem">
              <h4>{result.groups.find((group) => group.inputId === item.inputId)?.label}</h4>
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'date',
                    label: t('distribution.asOfDate'),
                    children: formatDate(item.asOfDate),
                  },
                  {
                    key: 'resolved',
                    label: t('distribution.membersResolved'),
                    children: String(item.membersResolved),
                  },
                  {
                    key: 'valid',
                    label: t('distribution.observationsValid'),
                    children: String(item.observationsValid),
                  },
                  {
                    key: 'missing',
                    label: t('distribution.missingMeasure'),
                    children: String(item.missingMeasure),
                  },
                  {
                    key: 'revision',
                    label: t('distribution.dataRevision'),
                    children: String(item.dataRevision),
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
        <div className="jx-distributionComparison-method">
          <Descriptions
            size="small"
            column={1}
            items={[
              {
                key: 'question',
                label: t('result.question'),
                children: run.plan.question.text,
              },
              {
                key: 'hypothesis',
                label: t('result.hypothesis'),
                children: t(
                  `distribution.hypothesisDirection.${run.plan.question.hypothesis.direction}`,
                ),
              },
              {
                key: 'measure',
                label: t('distribution.measure'),
                children: `${zh ? result.measure.nameZh : result.measure.nameEn} · ${result.measure.unit}`,
              },
            ]}
          />
          <MethodList title={t('result.assumptions')} items={run.protocol.assumptions} zh={zh} />
          <MethodList title={t('result.terminology')} items={run.protocol.terminology} zh={zh} />
          <div className="jx-distributionComparison-formulae">
            {run.protocol.formulae.map((formula) => (
              <section key={formula.id} className="jx-distributionComparison-formula">
                <h4>{zh ? formula.labelZh : formula.labelEn}</h4>
                <Markdown text={`$$${formula.latex}$$`} />
              </section>
            ))}
          </div>
          <ResearchFingerprintDetails run={run} />
          <section className="jx-distributionComparison-code">
            <h4>
              <FontAwesomeIcon icon={faCode} /> {t('result.pythonExample')}
            </h4>
            <Markdown text={`\`\`\`python\n${run.protocol.pythonExample}\n\`\`\``} />
          </section>
          <div className="jx-distributionComparison-docs">
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
    <Card className="jx-distributionComparison" size="small">
      <div className="jx-distributionComparison-head">
        <div className="jx-distributionComparison-title">
          <FontAwesomeIcon icon={faFlask} />
          <span>{title}</span>
        </div>
        <div className="jx-distributionComparison-actions">
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

      {controlsOpen && (
        <div className="jx-distributionComparison-controls">
          <label className="jx-distributionComparison-control">
            <span>{t('distribution.tailFraction')}</span>
            <InputNumber
              className="jx-distributionComparison-controlInput"
              min={1}
              max={20}
              step={1}
              precision={0}
              value={draft.protocol.sensitivity.tailFraction * 100}
              addonAfter="%"
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  protocol: {
                    ...current.protocol,
                    sensitivity: {
                      kind: 'winsorized_mean',
                      tailFraction: Math.min(20, Math.max(1, value ?? 5)) / 100,
                    },
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
          className="jx-distributionComparison-runError"
          type="error"
          showIcon
          message={t('result.rerunFailed')}
          description={runError}
        />
      )}

      <Conclusion conclusion={run.conclusion} zh={zh} />

      <div className="jx-distributionComparison-stats">
        <Stat label={t('distribution.groupACount')} value={String(groupA.summary.count)} />
        <Stat label={t('distribution.groupBCount')} value={String(groupB.summary.count)} />
        <Stat label={t('distribution.meanDifference')} value={number(comparison.meanDifference)} />
        <Stat label={t('distribution.welchT')} value={number(comparison.welchTStatistic)} />
        <Stat label="Cohen's d" value={number(comparison.cohensD)} />
        <Stat
          label={t('distribution.mannWhitneyP')}
          value={number(comparison.mannWhitneyTwoSidedPApprox)}
        />
      </div>

      {run.diagnostics.length > 0 && (
        <div className="jx-distributionComparison-diagnostics">
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
        className="jx-distributionComparison-tabs"
        items={tabs}
        defaultActiveKey="distribution"
        indicator={{ size: (origin) => origin - 4, align: 'center' }}
      />
    </Card>
  );
}

// —— 子组件 / 帮助函数 ——

function Conclusion({
  conclusion,
  zh,
}: {
  conclusion: DistributionComparisonConclusionV1;
  zh: boolean;
}) {
  const { t } = useTranslation('research');
  return (
    <Alert
      className="jx-distributionComparison-conclusion"
      type={conclusionAlertType(conclusion.level)}
      showIcon
      message={t(`result.conclusionLevel.${conclusion.level}`)}
      description={
        <div className="jx-distributionComparison-conclusionBody">
          <p>{zh ? conclusion.summaryZh : conclusion.summaryEn}</p>
          <div className="jx-distributionComparison-evidence">
            <span>
              {t('result.confidenceInterval')}: {number(conclusion.confidenceInterval95.lower)} —{' '}
              {number(conclusion.confidenceInterval95.upper)}
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
    <div className="jx-distributionComparison-stat">
      <span className="jx-distributionComparison-statLabel">{label}</span>
      <strong className="jx-distributionComparison-statValue">{value}</strong>
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
    <section className="jx-distributionComparison-methodList">
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

function formatDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
}

function boxplotOption(
  groups: DistributionComparisonRunResultV1['result']['groups'],
  valueLabel: string,
): ECOption {
  return {
    animation: false,
    grid: { left: 64, right: 24, top: 24, bottom: 42 },
    tooltip: { trigger: 'item' },
    xAxis: {
      type: 'category',
      data: groups.map((group) => group.label),
      axisLabel: { color: '#8a9099' },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: valueLabel,
      axisLabel: { color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        type: 'boxplot',
        data: groups.map(({ summary }) => [
          summary.minimum,
          summary.firstQuartile,
          summary.median,
          summary.thirdQuartile,
          summary.maximum,
        ]),
        itemStyle: { color: '#eef0f2', borderColor: '#59636f' },
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
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: [rawLabel, winsorizedLabel],
      axisLabel: { color: '#8a9099', interval: 0 },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: '#8a9099' },
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
