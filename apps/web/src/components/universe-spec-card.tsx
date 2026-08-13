import type { UniversePart } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import './universe-spec-card.css';

interface UniverseSpecCardProps {
  part: UniversePart;
}

/** Read-only Research artifact used by migrated saved screens and future Universe protocols. */
export function UniverseSpecCard({ part }: UniverseSpecCardProps) {
  const { t } = useTranslation('research');
  const { spec } = part;

  return (
    <section className="jx-universeSpecCard">
      <div className="jx-universeSpecCard-head">
        <strong>{part.title}</strong>
        <span className="jx-universeSpecCard-badge">{t('universe.migrated')}</span>
      </div>
      <div className="jx-universeSpecCard-meta">
        <span className="jx-universeSpecCard-chip">{t(`universe.source.${spec.source.kind}`)}</span>
        <span className="jx-universeSpecCard-chip">{t(`universe.asOf.${spec.asOf.kind}`)}</span>
        <span className="jx-universeSpecCard-chip">{t('universe.missingExclude')}</span>
        {spec.limit !== undefined && (
          <span className="jx-universeSpecCard-chip">
            {t('universe.limit', { count: spec.limit })}
          </span>
        )}
      </div>
      <div className="jx-universeSpecCard-predicates">
        {spec.predicates.length === 0 ? (
          <span className="jx-universeSpecCard-chip">{t('universe.noPredicates')}</span>
        ) : (
          spec.predicates.map((predicate, index) => (
            <code className="jx-universeSpecCard-code" key={`${predicate.measure}-${index}`}>
              {predicate.measure} {predicate.op} {predicate.value}
            </code>
          ))
        )}
        {spec.sort && (
          <code className="jx-universeSpecCard-code">
            {t('universe.sort')}: {spec.sort.measure} {spec.sort.direction}
          </code>
        )}
      </div>
    </section>
  );
}
