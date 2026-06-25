import classNames from 'classnames';
import { Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ScreenRow } from '@jixie/shared';
import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { complex } from './complex';
import { ConditionChips } from './condition-chips';
import { EXAMPLE_SCREENS } from './screen-store';
import './screen.css';

export const Screen = complex.component(() => {
  const store = complex.useStore();
  const result = store.result;

  return (
    <div className="jx-screen">
      <TopNav />

      <main className="jx-screen-body">
        <div className="jx-screen-bar">
          <Input.TextArea
            value={store.nlText}
            onChange={(e) => store.setNlText(e.target.value)}
            placeholder="用一句话描述选股条件，如「市盈率低于15、股息率大于3%的大盘股，按市值排序」"
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
          <Button
            type="primary"
            icon={<FontAwesomeIcon icon={faWandMagicSparkles} />}
            loading={store.parseLoader.loading}
            disabled={!store.nlText.trim()}
            onClick={() => store.searchNl()}
          >
            AI 选股
          </Button>
        </div>

        <div className="jx-screen-examples">
          <span className="jx-screen-examplesLabel">示例:</span>
          {EXAMPLE_SCREENS.map((ex) => (
            <Button key={ex.label} size="small" onClick={() => store.runExample(ex.spec)}>
              {ex.label}
            </Button>
          ))}
        </div>

        {/* NL/示例解析出的查询条件,回显成可编辑 chips;改任一条直接重查(不过模型) */}
        {store.spec && (
          <ConditionChips spec={store.spec} onChange={(s) => void store.applySpec(s)} />
        )}

        {store.parseLoader.error && (
          <div className="jx-screen-error">解析失败：{store.parseLoader.errorObject?.message}</div>
        )}

        {result && (
          <div className="jx-screen-summary">
            快照 {result.tradeDate} · 命中 {result.total} 只（展示前 {result.rows.length}）
          </div>
        )}

        <Table<ScreenRow>
          className="jx-screen-table"
          rowKey="tsCode"
          size="middle"
          loading={store.busy}
          dataSource={result?.rows ?? []}
          columns={COLUMNS}
          pagination={false}
          scroll={{ y: 'calc(100vh - 300px)' }}
          // Open the stock's K线/PE/量 in a new tab — keeps the screen list intact.
          onRow={(r) => ({ onClick: () => window.open(`/stock/${r.tsCode}`, '_blank') })}
        />
      </main>
    </div>
  );
}, 'Screen');

// —— 帮助函数 / 配置 ——

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
const num = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));
const yi = (wan: number | null) => (wan == null ? '—' : `${(wan / 1e4).toFixed(1)}亿`); // 万元 → 亿

const COLUMNS: ColumnsType<ScreenRow> = [
  {
    title: '名称',
    dataIndex: 'name',
    fixed: 'left',
    render: (_v, r) => (
      <div className="jx-screen-name">
        <span className="jx-screen-nameMain">{r.name}</span>
        <span className="jx-screen-nameCode">{r.tsCode}</span>
      </div>
    ),
  },
  { title: '现价', dataIndex: 'close', align: 'right', render: (v) => num(v) },
  {
    title: '涨跌',
    dataIndex: 'pctChg',
    align: 'right',
    render: (v: number | null) => (
      <span className={classNames({ 'text-up': (v ?? 0) > 0, 'text-down': (v ?? 0) < 0 })}>{pct(v)}</span>
    ),
  },
  { title: 'PE(TTM)', dataIndex: 'peTtm', align: 'right', render: (v) => num(v) },
  { title: 'PB', dataIndex: 'pb', align: 'right', render: (v) => num(v) },
  { title: '股息率', dataIndex: 'dvRatio', align: 'right', render: (v) => pct(v) },
  { title: '总市值', dataIndex: 'totalMv', align: 'right', render: (v) => yi(v) },
  { title: '换手率', dataIndex: 'turnoverRate', align: 'right', render: (v) => pct(v) },
];
