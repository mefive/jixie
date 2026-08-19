import { Alert, Button, Drawer, Empty, Skeleton, Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  ResearchCuratorDispositionV1,
  ResearchCuratorFindingCategoryV1,
  ResearchCuratorFindingV1,
  ResearchCuratorRunV1,
  ResearchCuratorVerificationAssessmentV1,
} from '@jixie/shared';
import {
  faCheck,
  faClock,
  faClone,
  faListCheck,
  faRotate,
  faThumbsUp,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { complex } from './complex';
import './research-curator-drawer.css';

type ResearchCuratorDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export const ResearchCuratorDrawer = complex.component(
  ({ open, onClose }: ResearchCuratorDrawerProps) => {
    const store = complex.useStore();
    const { t, i18n } = useTranslation('research');
    const run = store.curatorLoader.result;
    const running = run?.status === 'queued' || run?.status === 'running';
    const loading = store.curatorMutationLoader.loading;

    return (
      <Drawer
        className="jx-researchCurator"
        size="large"
        open={open}
        onClose={onClose}
        title={
          <span className="jx-researchCurator-title">
            <FontAwesomeIcon icon={faListCheck} /> {t('curator.title')}
          </span>
        }
        extra={
          <Tooltip title={running ? t('curator.running') : t('curator.run')}>
            <Button
              type="text"
              icon={<FontAwesomeIcon icon={run ? faRotate : faListCheck} />}
              loading={loading || running}
              aria-label={running ? t('curator.running') : t('curator.run')}
              onClick={() => void store.startCurator().catch(() => {})}
            />
          </Tooltip>
        }
      >
        <p className="jx-researchCurator-intro">{t('curator.intro')}</p>
        <Alert
          className="jx-researchCurator-guardrail"
          type="info"
          showIcon
          title={t('curator.guardrail')}
        />

        {store.curatorLoader.error && (
          <Alert
            className="jx-researchCurator-alert"
            type="error"
            showIcon
            title={store.curatorLoader.errorObject?.message || t('curator.loadFailed')}
          />
        )}
        {store.curatorMutationLoader.error && (
          <Alert
            className="jx-researchCurator-alert"
            type="error"
            showIcon
            title={store.curatorMutationLoader.errorObject?.message || t('curator.actionFailed')}
          />
        )}

        {store.curatorLoader.loading && !run ? (
          <div className="jx-researchCurator-skeleton">
            <Skeleton active paragraph={{ rows: 4 }} />
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : !run ? (
          <Empty
            className="jx-researchCurator-empty"
            description={t('curator.empty')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <>
            <CuratorRunSummary run={run} locale={i18n.resolvedLanguage} />
            <CuratorQuality run={run} />
            {running ? (
              <Alert
                className="jx-researchCurator-alert"
                type="info"
                showIcon
                title={t(`curator.status.${run.status}`)}
                description={t('curator.runningHint')}
              />
            ) : run.status === 'error' || run.status === 'stale' ? (
              <Alert
                className="jx-researchCurator-alert"
                type="error"
                showIcon
                title={t(`curator.status.${run.status}`)}
                description={run.error || t('curator.actionFailed')}
              />
            ) : run.findings.length === 0 ? (
              <Empty
                className="jx-researchCurator-empty"
                description={t('curator.noFindings')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <div className="jx-researchCurator-findings">
                {run.findings.map((finding) => (
                  <CuratorFinding key={finding.id} finding={finding} />
                ))}
              </div>
            )}
          </>
        )}
      </Drawer>
    );
  },
  'ResearchCuratorDrawer',
);

// —— Child components ——

const CuratorRunSummary = ({ run, locale }: { run: ResearchCuratorRunV1; locale?: string }) => {
  const { t } = useTranslation('research');
  return (
    <section className="jx-researchCurator-runSummary">
      <div>
        <strong>{run.evidenceCount}</strong>
        <span>{t('curator.summary.evidence')}</span>
      </div>
      <div>
        <strong>{run.findingsCreated}</strong>
        <span>{t('curator.summary.findings')}</span>
      </div>
      <div>
        <strong>{run.duplicatesSkipped}</strong>
        <span>{t('curator.summary.duplicates')}</span>
      </div>
      <time dateTime={run.createdAt}>
        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(run.createdAt),
        )}
      </time>
    </section>
  );
};

const CuratorQuality = ({ run }: { run: ResearchCuratorRunV1 }) => {
  const { t } = useTranslation('research');
  const { quality } = run;
  return (
    <section className="jx-researchCurator-quality">
      <div className="jx-researchCurator-qualityHead">
        <strong>{t('curator.quality.title')}</strong>
        <Tag color={quality.evaluationReady ? 'green' : 'default'}>
          {t(`curator.quality.${quality.evaluationReady ? 'ready' : 'collecting'}`)}
        </Tag>
      </div>
      <div className="jx-researchCurator-qualityMetrics">
        <QualityMetric
          label={t('curator.quality.acceptance')}
          value={formatRate(quality.acceptanceRate)}
          sample={t('curator.quality.reviewedSample', {
            count: quality.reviewed,
            minimum: quality.minimumReviewedFindings,
          })}
        />
        <QualityMetric
          label={t('curator.quality.duplicates')}
          value={formatRate(quality.duplicateRate)}
          sample={t('curator.quality.duplicateSample', {
            count: quality.duplicates + quality.duplicatesSkipped,
          })}
        />
        <QualityMetric
          label={t('curator.quality.verificationErrors')}
          value={formatRate(quality.verificationErrorRate)}
          sample={t('curator.quality.verificationSample', {
            count: quality.verificationAssessments,
            minimum: quality.minimumVerificationAssessments,
          })}
        />
      </div>
    </section>
  );
};

const QualityMetric = ({
  label,
  value,
  sample,
}: {
  label: string;
  value: string;
  sample: string;
}) => (
  <div>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{sample}</small>
  </div>
);

const CuratorFinding = complex.component(({ finding }: { finding: ResearchCuratorFindingV1 }) => {
  const store = complex.useStore();
  const { t, i18n } = useTranslation('research');
  const saving = store.curatorMutationLoader.loading;

  return (
    <article className="jx-researchCurator-finding">
      <div className="jx-researchCurator-findingHead">
        <div className="jx-researchCurator-tags">
          <Tag color={categoryColor(finding.category)}>
            {t(`curator.category.${finding.category}`)}
          </Tag>
          <Tag color={finding.verification.status === 'verified' ? 'green' : 'gold'}>
            {t(`curator.verification.${finding.verification.status}`)}
          </Tag>
        </div>
        <span className="jx-researchCurator-confidence">
          {t('curator.confidence', { value: Math.round(finding.confidence * 100) })}
        </span>
      </div>
      <h3>{finding.title}</h3>
      <p>{finding.summary}</p>

      <dl className="jx-researchCurator-details">
        <div>
          <dt>{t('curator.expectedValue')}</dt>
          <dd>{finding.expectedValue}</dd>
        </div>
        <div>
          <dt>{t('curator.suggestedAction')}</dt>
          <dd>{finding.suggestedAction}</dd>
        </div>
        <div>
          <dt>{t('curator.changeSurface')}</dt>
          <dd>{finding.changeSurface.join(' · ') || t('curator.notSpecified')}</dd>
        </div>
      </dl>

      {finding.verification.matches.length > 0 && (
        <div className="jx-researchCurator-matches">
          <span>{t('curator.matchedCapabilities')}</span>
          {finding.verification.matches.map((match) => (
            <Tag key={`${match.kind}:${match.id}`}>{match.id}</Tag>
          ))}
        </div>
      )}
      <div className="jx-researchCurator-verificationNotes">
        <strong>{t('curator.verificationNotes')}</strong>
        <ul>
          {finding.verification.notes.map((note) => (
            <li key={note}>{t(`curator.verificationNote.${note}`)}</li>
          ))}
        </ul>
      </div>

      {finding.verification.evidence.length > 0 && (
        <div className="jx-researchCurator-verificationEvidence">
          <strong>{t('curator.verificationEvidence')}</strong>
          <ul>
            {finding.verification.evidence.map((item) => (
              <li key={`${item.kind}:${item.reference}`}>
                <Tag color={item.stance === 'supports' ? 'green' : 'gold'}>
                  {t(`curator.verificationStance.${item.stance}`)}
                </Tag>
                <span>
                  {i18n.resolvedLanguage?.startsWith('zh') ? item.detailZh : item.detailEn}
                </span>
                <code>{item.reference}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="jx-researchCurator-evidence">
        <strong>{t('curator.evidence')}</strong>
        {finding.evidence.map((evidence) => (
          <blockquote key={evidence.id}>{evidence.excerpt}</blockquote>
        ))}
      </div>

      <div className="jx-researchCurator-verificationFeedback">
        <span>{t('curator.verificationFeedback.label')}</span>
        {VERIFICATION_ACTIONS.map(({ assessment, icon }) => {
          const label = t(`curator.verificationFeedback.${assessment}`);
          return (
            <Tooltip key={assessment} title={label}>
              <Button
                size="small"
                type={finding.verificationAssessment === assessment ? 'primary' : 'text'}
                danger={assessment === 'incorrect'}
                icon={<FontAwesomeIcon icon={icon} />}
                aria-label={label}
                disabled={saving || finding.verificationAssessment === assessment}
                onClick={() =>
                  void store.assessCuratorVerification(finding.id, assessment).catch(() => {})
                }
              />
            </Tooltip>
          );
        })}
      </div>

      <div className="jx-researchCurator-actions">
        {DISPOSITION_ACTIONS.map(({ disposition, icon }) => {
          const label = t(`curator.disposition.${disposition}`);
          return (
            <Tooltip key={disposition} title={label}>
              <Button
                size="small"
                type={finding.disposition === disposition ? 'primary' : 'text'}
                icon={<FontAwesomeIcon icon={icon} />}
                aria-label={label}
                loading={saving && finding.disposition !== disposition}
                disabled={saving || finding.disposition === disposition}
                onClick={() =>
                  void store.setCuratorDisposition(finding.id, disposition).catch(() => {})
                }
              />
            </Tooltip>
          );
        })}
      </div>
    </article>
  );
}, 'CuratorFinding');

const DISPOSITION_ACTIONS: Array<{
  disposition: Exclude<ResearchCuratorDispositionV1, 'pending'>;
  icon: typeof faCheck;
}> = [
  { disposition: 'accepted', icon: faCheck },
  { disposition: 'rejected', icon: faXmark },
  { disposition: 'deferred', icon: faClock },
  { disposition: 'duplicate', icon: faClone },
];

const VERIFICATION_ACTIONS: Array<{
  assessment: ResearchCuratorVerificationAssessmentV1;
  icon: typeof faCheck;
}> = [
  { assessment: 'correct', icon: faThumbsUp },
  { assessment: 'incorrect', icon: faTriangleExclamation },
];

function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function categoryColor(category: ResearchCuratorFindingCategoryV1): string {
  const colors: Record<ResearchCuratorFindingCategoryV1, string> = {
    method_candidate: 'blue',
    supplier_data_gap: 'purple',
    local_capability_gap: 'cyan',
    documentation_gap: 'gold',
    tool_or_interaction_defect: 'red',
    no_action: 'default',
  };
  return colors[category];
}
