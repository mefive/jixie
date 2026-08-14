import { Alert, Button, Drawer, Empty, Skeleton, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  ResearchCuratorDispositionV1,
  ResearchCuratorFindingCategoryV1,
  ResearchCuratorFindingV1,
  ResearchCuratorRunV1,
} from '@jixie/shared';
import {
  faCheck,
  faClock,
  faClone,
  faRotate,
  faWandMagicSparkles,
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
        width="min(640px, 100vw)"
        open={open}
        onClose={onClose}
        title={
          <span className="jx-researchCurator-title">
            <FontAwesomeIcon icon={faWandMagicSparkles} /> {t('curator.title')}
          </span>
        }
        extra={
          <Button
            type="primary"
            icon={<FontAwesomeIcon icon={run ? faRotate : faWandMagicSparkles} />}
            loading={loading || running}
            onClick={() => void store.startCurator().catch(() => {})}
          >
            {running ? t('curator.running') : t('curator.run')}
          </Button>
        }
      >
        <p className="jx-researchCurator-intro">{t('curator.intro')}</p>
        <Alert
          className="jx-researchCurator-guardrail"
          type="info"
          showIcon
          message={t('curator.guardrail')}
        />

        {store.curatorLoader.error && (
          <Alert
            className="jx-researchCurator-alert"
            type="error"
            showIcon
            message={store.curatorLoader.errorObject?.message || t('curator.loadFailed')}
          />
        )}
        {store.curatorMutationLoader.error && (
          <Alert
            className="jx-researchCurator-alert"
            type="error"
            showIcon
            message={store.curatorMutationLoader.errorObject?.message || t('curator.actionFailed')}
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
            {running ? (
              <Alert
                className="jx-researchCurator-alert"
                type="info"
                showIcon
                message={t(`curator.status.${run.status}`)}
                description={t('curator.runningHint')}
              />
            ) : run.status === 'error' || run.status === 'stale' ? (
              <Alert
                className="jx-researchCurator-alert"
                type="error"
                showIcon
                message={t(`curator.status.${run.status}`)}
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

const CuratorFinding = complex.component(({ finding }: { finding: ResearchCuratorFindingV1 }) => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
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

      <div className="jx-researchCurator-evidence">
        <strong>{t('curator.evidence')}</strong>
        {finding.evidence.map((evidence) => (
          <blockquote key={evidence.id}>{evidence.excerpt}</blockquote>
        ))}
      </div>

      <div className="jx-researchCurator-actions">
        {DISPOSITION_ACTIONS.map(({ disposition, icon }) => (
          <Button
            key={disposition}
            size="small"
            type={finding.disposition === disposition ? 'primary' : 'default'}
            icon={<FontAwesomeIcon icon={icon} />}
            loading={saving && finding.disposition !== disposition}
            disabled={saving || finding.disposition === disposition}
            onClick={() =>
              void store.setCuratorDisposition(finding.id, disposition).catch(() => {})
            }
          >
            {t(`curator.disposition.${disposition}`)}
          </Button>
        ))}
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

function categoryColor(category: ResearchCuratorFindingCategoryV1): string {
  const colors: Record<ResearchCuratorFindingCategoryV1, string> = {
    protocol_candidate: 'blue',
    supplier_data_gap: 'purple',
    local_capability_gap: 'cyan',
    documentation_gap: 'gold',
    tool_or_interaction_defect: 'red',
    no_action: 'default',
  };
  return colors[category];
}
