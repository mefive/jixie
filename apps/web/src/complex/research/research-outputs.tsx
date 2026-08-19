import { lazy, Suspense } from 'react';
import type { ResearchCellOutputBlockV1 } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import { researchArtifactUrl } from '@src/api/client';
import { ResearchCellTable } from './research-cell-table';

const ResearchCellChart = lazy(() => import('./research-cell-chart'));

export function ResearchOutputs({ outputs }: { outputs: ResearchCellOutputBlockV1[] }) {
  if (outputs.length === 0) {
    return null;
  }
  return (
    <div className="jx-research-outputs">
      {outputs.map((output, index) => (
        <ResearchOutput key={index} output={output} />
      ))}
    </div>
  );
}

function ResearchOutput({ output }: { output: ResearchCellOutputBlockV1 }) {
  const { t } = useTranslation('research');
  switch (output.type) {
    case 'text':
      return (
        <pre className={`jx-research-textOutput jx-research-textOutput--${output.level ?? 'info'}`}>
          {output.text}
        </pre>
      );
    case 'value':
      return <pre className="jx-research-valueOutput">{JSON.stringify(output.value, null, 2)}</pre>;
    case 'table':
      return <ResearchCellTable output={output} />;
    case 'chart':
      return (
        <section className="jx-research-chartOutput" data-testid="research-interactive-chart">
          <Suspense fallback={<div className="jx-research-chartPending" />}>
            <ResearchCellChart chart={output} />
          </Suspense>
        </section>
      );
    case 'image': {
      const source = output.artifactId ? researchArtifactUrl(output.artifactId) : output.dataUrl;
      return source ? (
        <figure className="jx-research-imageOutput" data-testid="research-image-output">
          <img
            src={source}
            alt={output.alt ?? t('workbench.pythonFigure')}
            loading="lazy"
            decoding="async"
            {...(output.width ? { width: output.width } : {})}
            {...(output.height ? { height: output.height } : {})}
          />
        </figure>
      ) : null;
    }
  }
}
