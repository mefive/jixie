import { Alert, Descriptions, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ResearchPlanSpecV1,
  ResearchRunRecordRefV1,
  ResearchRunRecordV1,
  ResearchRunComparisonV1,
  ResearchRunResultV1,
} from '@jixie/shared';
import { listResearchStudyRuns, rerunResearchStudy, runResearchPlan } from '@src/api/client';

export function useResearchRunHistory<Run extends ResearchRunResultV1>(
  initialRun: Run,
  initialRecord?: ResearchRunRecordRefV1,
) {
  const [run, setRun] = useState(initialRun);
  const [record, setRecord] = useState(initialRecord);
  const [records, setRecords] = useState<ResearchRunRecordV1[]>([]);
  const studyId = initialRecord?.studyId;

  useEffect(() => {
    if (!studyId) {
      return;
    }

    let active = true;
    void listResearchStudyRuns(studyId)
      .then((loaded) => {
        if (!active) {
          return;
        }
        setRecords(loaded);
        const latest = loaded.at(-1);
        if (latest) {
          setRun(latest.run as Run);
          setRecord(latest.ref);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [studyId]);

  const rerun = async (plan: ResearchPlanSpecV1): Promise<Run> => {
    if (!record) {
      const next = (await runResearchPlan(plan)) as Run;
      setRun(next);
      return next;
    }

    const next = await rerunResearchStudy(record.studyId, record.runId, plan);
    setRecords((current) => [...current, next]);
    setRecord(next.ref);
    setRun(next.run as Run);
    return next.run as Run;
  };

  const select = (runId: string) => {
    const selected = records.find((candidate) => candidate.ref.runId === runId);
    if (!selected) {
      return;
    }
    setRecord(selected.ref);
    setRun(selected.run as Run);
  };

  const comparison = records.find(
    (candidate) => candidate.ref.runId === record?.runId,
  )?.comparisonToParent;
  return { run, record, records, comparison, rerun, select };
}

export function ResearchRunHistorySelect({
  records,
  runId,
  label,
  onChange,
}: {
  records: ResearchRunRecordV1[];
  runId?: string;
  label: string;
  onChange: (runId: string) => void;
}) {
  const { i18n } = useTranslation('research');
  if (records.length === 0 || !runId) {
    return null;
  }
  return (
    <Select
      className="jx-researchRunHistory"
      size="small"
      aria-label={label}
      value={runId}
      options={records.map((record) => ({
        value: record.ref.runId,
        label: `#${record.ref.sequence} · ${formatRunTime(record.ref.createdAt, i18n.language)}`,
      }))}
      onChange={onChange}
    />
  );
}

export function ResearchRunComparisonNotice({
  comparison,
}: {
  comparison?: ResearchRunComparisonV1;
}) {
  const { t } = useTranslation('research');
  if (!comparison) {
    return null;
  }
  const details = [
    ...comparison.changes.map((change) => t(`result.runComparison.change.${change}`)),
    t(
      comparison.resultChanged
        ? 'result.runComparison.resultChanged'
        : 'result.runComparison.resultUnchanged',
    ),
    ...(comparison.conclusionChanged ? [t('result.runComparison.conclusionChanged')] : []),
  ];
  return (
    <Alert
      className="jx-researchRunComparison"
      type={comparison.attribution === 'unchanged' ? 'success' : 'info'}
      showIcon
      message={t(`result.runComparison.attribution.${comparison.attribution}`)}
      description={details.join(' · ')}
    />
  );
}

export function ResearchFingerprintDetails({ run }: { run: ResearchRunResultV1 }) {
  const { t } = useTranslation('research');
  const fingerprints = run.fingerprints;
  if (!fingerprints) {
    return null;
  }
  return (
    <section className="jx-researchFingerprints">
      <h4>{t('result.fingerprints.title')}</h4>
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: 'protocol',
            label: t('result.fingerprints.protocol'),
            children: `${fingerprints.protocol.id} v${fingerprints.protocol.version} · ${shortHash(fingerprints.protocol.implementationHash)}`,
          },
          {
            key: 'revision',
            label: t('result.fingerprints.appRevision'),
            children: shortHash(fingerprints.protocol.appRevision),
          },
          {
            key: 'data',
            label: t('result.fingerprints.data'),
            children: shortHash(fingerprints.data.hash),
          },
          {
            key: 'environment',
            label: t('result.fingerprints.environment'),
            children: `Node ${fingerprints.environment.nodeVersion} · ${fingerprints.environment.platform}/${fingerprints.environment.architecture} · ${shortHash(fingerprints.environment.hash)}`,
          },
        ]}
      />
    </section>
  );
}

function formatRunTime(createdAt: string, language: string): string {
  return new Intl.DateTimeFormat(language.startsWith('zh') ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(createdAt));
}

function shortHash(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}
