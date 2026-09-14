import { useState } from 'react';
import { Alert, Button, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ResearchEmbeddedDocumentSourceV1 } from '@jixie/shared';
import { EmbeddedAnalysisInspector } from './embedded-analysis-card';
import './embedded-analysis-toolbar.css';

interface EmbeddedResearchSourceProps {
  source: ResearchEmbeddedDocumentSourceV1;
  disabled: boolean;
  onChangeMode(mode: 'retained' | 'current'): void;
}

export function EmbeddedResearchSource({
  source,
  disabled,
  onChangeMode,
}: EmbeddedResearchSourceProps) {
  const { t } = useTranslation('embedded');
  const [open, setOpen] = useState(false);
  return (
    <section className="jx-embeddedToolbar" data-testid="embedded-research-source">
      <Alert
        type="info"
        title={t('continuedFrom', { title: source.title })}
        description={t(source.inputMode === 'retained' ? 'retainedHint' : 'currentHint')}
      />
      <div className="jx-embeddedToolbar-actions">
        <Button size="small" onClick={() => setOpen(true)}>
          {t('originalRun')}
        </Button>
        <Select
          aria-label={t('inputMode')}
          value={source.inputMode}
          disabled={disabled}
          onChange={onChangeMode}
          options={[
            { value: 'retained', label: t('retainedMode') },
            { value: 'current', label: t('currentMode') },
          ]}
        />
      </div>
      <EmbeddedAnalysisInspector
        open={open}
        onClose={() => setOpen(false)}
        part={{ type: 'embedded_analysis', title: source.title, reference: source }}
      />
    </section>
  );
}
