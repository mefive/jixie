import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type {
  ResearchUniverseRowV1,
  ResearchUniverseRunResultV1,
  UniversePart,
} from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import { runResearchUniverse } from '@src/api/client';
import './universe-spec-card.css';

interface UniverseSpecCardProps {
  part: UniversePart;
}

/** Read-only Research artifact used by migrated saved screens and point-in-time universe queries. */
export function UniverseSpecCard({ part }: UniverseSpecCardProps) {
  const { t, i18n } = useTranslation('research');
  const { spec } = part;
  const [result, setResult] = useState<ResearchUniverseRunResultV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await runResearchUniverse(spec));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('universe.runFailed'));
    } finally {
      setLoading(false);
    }
  }, [spec, t]);

  useEffect(() => {
    void run();
  }, [run]);

  const zh = i18n.language.startsWith('zh');
  const columns: ColumnsType<ResearchUniverseRowV1> = [
    {
      key: 'entity',
      title: t('universe.entity'),
      fixed: 'left',
      width: 180,
      render: (_, row) => (
        <a
          href={`/objects/${row.entity.assetType}/${encodeURIComponent(row.entity.id)}`}
          target="_blank"
          rel="noreferrer"
        >
          {row.name} · {row.entity.id}
        </a>
      ),
    },
    {
      key: 'industry',
      title: t('universe.industry'),
      dataIndex: 'industry',
      width: 120,
      render: (value: string | null) => value ?? '—',
    },
    ...(result?.measures.map((measure): ColumnsType<ResearchUniverseRowV1>[number] => ({
      key: measure.id,
      title: `${zh ? measure.nameZh : measure.nameEn} · ${measure.unit}`,
      width: 150,
      align: 'right',
      render: (_, row) => formatValue(row.values[measure.id], measure.unit),
    })) ?? []),
  ];

  return (
    <section className="jx-universeSpecCard">
      <div className="jx-universeSpecCard-head">
        <strong>{part.title}</strong>
        <div className="jx-universeSpecCard-actions">
          <span className="jx-universeSpecCard-badge">UniverseSpec V1</span>
          <Button size="small" loading={loading} onClick={() => void run()}>
            {t('universe.rerun')}
          </Button>
        </div>
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
      <div className="jx-universeSpecCard-eligibility">
        {t('universe.eligibility', {
          days: spec.eligibility.minimumListedDays,
          risk: t(`universe.riskWarning.${spec.eligibility.riskWarning}`),
        })}
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {loading && !result ? (
        <div className="jx-universeSpecCard-loading">
          <Spin size="small" />
        </div>
      ) : (
        result && (
          <>
            <div className="jx-universeSpecCard-summary">
              {t('universe.summary', {
                date: formatDate(result.asOfDate),
                total: result.total,
                shown: result.rows.length,
                revision: result.dataRevision,
              })}
            </div>
            <div className="jx-universeSpecCard-stages">
              {result.stages.map((stage) => (
                <span key={stage.code} className="jx-universeSpecCard-chip">
                  {t(`universe.stage.${stage.code}`)} {stage.count}
                </span>
              ))}
            </div>
            {result.diagnostics.map((diagnostic, index) => (
              <Alert
                key={`${diagnostic.code}-${index}`}
                type={diagnostic.severity === 'error' ? 'error' : diagnostic.severity}
                showIcon
                message={zh ? diagnostic.messageZh : diagnostic.messageEn}
              />
            ))}
            <Table<ResearchUniverseRowV1>
              className="jx-universeSpecCard-table"
              rowKey={(row) => `${row.entity.assetType}:${row.entity.id}`}
              columns={columns}
              dataSource={result.rows}
              size="small"
              pagination={false}
              scroll={{ x: 'max-content', y: 360 }}
            />
          </>
        )
      )}
    </section>
  );
}

function formatDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatValue(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  if (unit === 'CNY_10k') {
    return `${(value / 10_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 亿`;
  }
  if (unit === 'percent') {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
