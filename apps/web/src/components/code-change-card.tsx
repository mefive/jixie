import { lazy, Suspense, useState } from 'react';
import { Alert, Button, Modal, Tag } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCodeCompare, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { CodeChangeProposalV1 } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import './code-change-card.css';

const CodeChangeDiff = lazy(() => import('./code-change-diff'));

interface CodeChangeCardProps {
  proposal: CodeChangeProposalV1;
  currentCode?: string;
  currentLanguage?: 'typescript' | 'python';
  onAccept?: (proposal: CodeChangeProposalV1) => Promise<void>;
  busy?: boolean;
  error?: string;
}

/**
 * 只在用户点开后展示差异，关闭不修改代码或提案状态。
 *
 * Show differences only on request; closing changes neither code nor proposal state.
 */
export default function CodeChangeCard({
  proposal,
  currentCode,
  currentLanguage,
  onAccept,
  busy = false,
  error,
}: CodeChangeCardProps) {
  const { t } = useTranslation('components');
  const [open, setOpen] = useState(false);
  const pending = proposal.status === 'pending';
  const conflict =
    pending &&
    Boolean(onAccept) &&
    (currentCode !== proposal.beforeCode || currentLanguage !== proposal.language);

  return (
    <section className="jx-codeChange-card" data-testid={`code-change-${proposal.id}`}>
      <div className="jx-codeChange-heading">
        <FontAwesomeIcon icon={faCodeCompare} />
        <span>{t('codeChange.title')}</span>
        <Tag>{t(`codeChange.${proposal.status}`)}</Tag>
      </div>
      <p>{t(pending ? 'codeChange.hint' : 'codeChange.acceptedHint')}</p>
      <Button onClick={() => setOpen(true)}>{t('codeChange.view')}</Button>
      <Modal
        title={t('codeChange.title')}
        open={open}
        width="min(1360px, calc(100vw - 48px))"
        onCancel={() => setOpen(false)}
        destroyOnHidden
        closeIcon={<FontAwesomeIcon icon={faXmark} />}
        footer={
          pending && onAccept ? (
            <Button
              type="primary"
              loading={busy}
              disabled={conflict}
              data-testid="code-change-accept"
              onClick={() => void onAccept(proposal).catch(() => {})}
            >
              {t('codeChange.accept')}
            </Button>
          ) : null
        }
      >
        <div className="jx-codeChange-content">
          {conflict && <Alert type="warning" showIcon title={t('codeChange.conflict')} />}
          {error && <Alert type="error" showIcon title={error} />}
          <Suspense fallback={<div>{t('codeChange.loading')}</div>}>
            <CodeChangeDiff proposal={proposal} />
          </Suspense>
        </div>
      </Modal>
    </section>
  );
}
