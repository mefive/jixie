import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { ScreenField, ScreenRow, ScreenSpec } from '@jixie/shared';
import { faFilter, faSpinner, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { reactUtils } from '@src/lib';
import { saveScreen } from '@src/api/client';
import i18n from '@src/i18n';
import { formatMarketCapWan } from '@src/i18n/format';
import type { QueryCardResults } from './query-card-model';
import './query-card.css';

interface QueryCardProps {
  title: string;
  spec: ScreenSpec;
  results: QueryCardResults;
  onPinned?: () => void;
}

/**
 * A query card inside an agent conversation: renders the SPEC's fresh result (compact table, top
 * rows), so a reopened conversation never shows stale data. Row click opens the stock page; Pin
 * saves the spec to the card wall (SavedScreen). An invalid/outdated spec degrades to an inline
 * error instead of crashing the conversation.
 */
export const QueryCard = reactUtils.observer(
  ({ title, spec, results, onPinned }: QueryCardProps) => {
    const { t } = useTranslation('components');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
      results.load(spec);
      // The spec of a given card never changes (cards are immutable message parts).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const state = results.get(spec);

    const pin = async () => {
      setSaving(true);
      try {
        await saveScreen(title.slice(0, 40) || t('unnamedScreen'), spec);
        onPinned?.();
        void message.success(t('pinnedToWall'));
      } catch (e) {
        void message.error(e instanceof Error ? e.message : t('saveFailed'));
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="jx-queryCard">
        <div className="jx-queryCard-head">
          <span className="jx-queryCard-title">
            <FontAwesomeIcon icon={faFilter} /> {title}
          </span>
          <span className="jx-queryCard-meta">
            {state?.result
              ? `${state.result.tradeDate} · ${t('stockCount', { count: state.result.total })}`
              : ''}
          </span>
          <Tooltip title={t('pinTooltip')}>
            <button className="jx-queryCard-pin" onClick={() => void pin()} disabled={saving}>
              <FontAwesomeIcon icon={saving ? faSpinner : faThumbtack} spin={saving} />
            </button>
          </Tooltip>
        </div>
        {(!state || state.loading) && (
          // Table-shaped skeleton close to the final table's height — the chat column must not
          // collapse-then-expand around a one-line spinner while the spec re-runs.
          <div className="jx-queryCard-skeleton">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="jx-queryCard-skeletonRow" />
            ))}
          </div>
        )}
        {state?.error && (
          <div className="jx-queryCard-status jx-queryCard-status--error">
            {t('queryFailedMaybeExpired')}
            {state.error}
          </div>
        )}
        {state?.result && (
          <Table<ScreenRow>
            className="jx-queryCard-table"
            size="small"
            rowKey="tsCode"
            columns={cardColumns(spec)}
            dataSource={state.result.rows.slice(0, CARD_ROW_CAP)}
            pagination={false}
            onRow={(row) => ({ onClick: () => window.open(`/stock/${row.tsCode}`, '_blank') })}
          />
        )}
        {state?.result && state.result.rows.length > CARD_ROW_CAP && (
          <div className="jx-queryCard-more">{t('moreRows', { count: CARD_ROW_CAP })}</div>
        )}
      </div>
    );
  },
  'QueryCard',
);

// —— Helpers ——

const CARD_ROW_CAP = 8;

// Column labels, read at render time so a language switch re-labels the table. PE/PB/PS stay literal.
function fieldLabel(field: ScreenField): string {
  const labels: Record<ScreenField, string> = {
    close: i18n.t('components:field.close'),
    pctChg: i18n.t('components:field.pctChg'),
    pe: 'PE',
    peTtm: 'PE(TTM)',
    pb: 'PB',
    ps: 'PS',
    dvRatio: i18n.t('components:field.dvRatio'),
    totalMv: i18n.t('components:field.totalMv'),
    circMv: i18n.t('components:field.circMv'),
    turnoverRate: i18n.t('components:field.turnoverRate'),
  };
  return labels[field];
}

const PERCENT_FIELDS = new Set<ScreenField>(['pctChg', 'dvRatio', 'turnoverRate']);
const MARKET_VALUE_FIELDS = new Set<ScreenField>(['totalMv', 'circMv']);

function formatField(field: ScreenField, value: number | null): string {
  if (value == null) {
    return '—';
  }
  if (PERCENT_FIELDS.has(field)) {
    return `${value.toFixed(2)}%`;
  }
  if (MARKET_VALUE_FIELDS.has(field)) {
    return formatMarketCapWan(value); // value arrives in 10k CNY
  }
  return value.toFixed(2);
}

/** Name + the fields the spec actually filters/sorts on (deduped, capped) — a compact, relevant table. */
function cardColumns(spec: ScreenSpec): ColumnsType<ScreenRow> {
  const fields: ScreenField[] = [];
  for (const field of [...spec.filters.map((f) => f.field), spec.sort?.field]) {
    if (field && !fields.includes(field)) {
      fields.push(field);
    }
  }
  const shown = (fields.length ? fields : ['close', 'pctChg']).slice(0, 3) as ScreenField[];
  return [
    {
      title: i18n.t('components:nameColumn'),
      dataIndex: 'name',
      render: (_v, row) => (
        <div className="jx-queryCard-name">
          <span className="jx-queryCard-nameMain">{row.name}</span>
          <span className="jx-queryCard-nameCode">{row.tsCode}</span>
        </div>
      ),
    },
    ...shown.map((field) => ({
      title: fieldLabel(field),
      dataIndex: field,
      align: 'right' as const,
      render: (value: number | null) =>
        field === 'pctChg' ? (
          <span
            className={classNames({ 'text-up': (value ?? 0) > 0, 'text-down': (value ?? 0) < 0 })}
          >
            {formatField(field, value)}
          </span>
        ) : (
          formatField(field, value)
        ),
    })),
  ];
}
