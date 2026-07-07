import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ScreenField, ScreenRow, ScreenSpec } from '@jixie/shared';
import { faFilter, faSpinner, faThumbtack } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { reactUtils } from '@src/lib';
import { saveScreen } from '@src/api/client';
import type { QueryCardResults } from './query-card-model';
import './query-card.css';

interface QueryCardProps {
  title: string;
  spec: ScreenSpec;
  results: QueryCardResults;
}

/**
 * A query card inside an agent conversation: renders the SPEC's fresh result (compact table, top
 * rows), so a reopened conversation never shows stale data. Row click opens the stock page; 钉住
 * saves the spec to the card wall (SavedScreen). An invalid/outdated spec degrades to an inline
 * error instead of crashing the conversation.
 */
export const QueryCard = reactUtils.observer(({ title, spec, results }: QueryCardProps) => {
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
      await saveScreen(title.slice(0, 40) || '未命名筛选', spec);
      void message.success('已钉到卡片墙(选股页)');
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '保存失败');
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
          {state?.result ? `${state.result.tradeDate} · 共 ${state.result.total} 只` : ''}
        </span>
        <Tooltip title="钉到卡片墙(保存这条筛选,选股页可反复重跑)">
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
          查询失败(条件可能已过期):{state.error}
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
        <div className="jx-queryCard-more">前 {CARD_ROW_CAP} 条,钉住后到选股页看全部</div>
      )}
    </div>
  );
}, 'QueryCard');

// —— 帮助函数 ——

const CARD_ROW_CAP = 8;

const FIELD_LABELS: Record<ScreenField, string> = {
  close: '现价',
  pctChg: '涨跌',
  pe: 'PE',
  peTtm: 'PE(TTM)',
  pb: 'PB',
  ps: 'PS',
  dvRatio: '股息率',
  totalMv: '总市值',
  circMv: '流通市值',
  turnoverRate: '换手率',
};

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
    return `${(value / 10000).toFixed(0)}亿`; // stored in 万元
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
      title: '名称',
      dataIndex: 'name',
      render: (_v, row) => (
        <div className="jx-queryCard-name">
          <span className="jx-queryCard-nameMain">{row.name}</span>
          <span className="jx-queryCard-nameCode">{row.tsCode}</span>
        </div>
      ),
    },
    ...shown.map((field) => ({
      title: FIELD_LABELS[field],
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
