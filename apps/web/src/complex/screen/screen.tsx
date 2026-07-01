import { useState } from 'react';
import classNames from 'classnames';
import { Button, Input, Modal, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ScreenRow } from '@jixie/shared';
import { faPaperPlane, faPen, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { SavedBar } from '@src/components/saved-bar';
import { LoaderButton } from '@src/components/loader-button';
import { complex } from './complex';
import { ConditionChips } from './condition-chips';
import { EXAMPLE_SCREENS } from './screen-store';
import './screen.css';

/**
 * 选股看图. One box takes both a natural-language screen ("便宜的高股息大盘股") and a direct instrument
 * reference ("贵州茅台" / "601398"); the server resolves which. Two modes:
 *   - empty (nothing run): a ChatGPT-style centered single input (HeroSearch).
 *   - working (have results): the submitted prompt collapses to a read-only bubble with an edit pencil
 *     (→ a frosted modal), plus the editable condition chips (screen only) and the result table.
 * Enter sends; Shift+Space / Shift+Enter insert a newline.
 */
export const Screen = complex.component(() => {
  const store = complex.useStore();
  const [editOpen, setEditOpen] = useState(false);
  const result = store.result;
  const hero = !result; // nothing run yet

  const submit = () => {
    void store.searchNl();
    setEditOpen(false);
  };
  // Edit the current prompt (or, after an example, start a fresh NL query) — prefill the box and open the modal.
  const openEdit = () => {
    store.setNlText(store.submittedPrompt);
    setEditOpen(true);
  };

  return (
    <div className="jx-screen">
      <TopNav />

      {hero ? (
        <HeroSearch onSubmit={submit} />
      ) : (
        <main className="jx-screen-body">
          <WorkBar onEdit={openEdit} />

          {/* NL/示例解析出的查询条件,回显成可编辑 chips;改任一条直接重查(不过模型)。lookup 无 spec → 不显示 */}
          {store.spec && <ConditionChips spec={store.spec} onChange={(s) => void store.applySpec(s)} />}

          {store.queryLoader.error && (
            <div className="jx-screen-error">解析失败：{store.queryLoader.errorObject?.message}</div>
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
            scroll={{ y: 'calc(100vh - 320px)' }}
            // Open the stock's K线/PE/量 in a new tab — keeps the screen list intact.
            onRow={(r) => ({ onClick: () => window.open(`/stock/${r.tsCode}`, '_blank') })}
          />
        </main>
      )}

      <EditPromptModal open={editOpen} onClose={() => setEditOpen(false)} onSubmit={submit} />
    </div>
  );
}, 'Screen');

// —— 子组件 ——

// Empty state: a centered single input, ChatGPT/Google style.
const HeroSearch = complex.component(({ onSubmit }: { onSubmit: () => void }) => {
  const store = complex.useStore();
  return (
    <main className="jx-screen-hero">
      <div className="jx-screen-heroInner">
        <h1 className="jx-screen-heroTitle">选股看图</h1>
        <p className="jx-screen-heroHint">描述你想要的股票，或直接输入名称 / 代码</p>

        <div className="jx-screen-heroBox">
          <PromptInput
            value={store.nlText}
            onChange={(v) => store.setNlText(v)}
            onSubmit={onSubmit}
            placeholder="如「市盈率低于15、股息率大于3%的大盘股」，或「贵州茅台」「601398」"
            autoFocus
          />
          <LoaderButton
            type="primary"
            shape="circle"
            className="jx-screen-send"
            icon={<FontAwesomeIcon icon={faPaperPlane} />}
            loader={store.queryLoader}
            disabled={!store.nlText.trim()}
            action={onSubmit}
          />
        </div>

        <div className="jx-screen-examples">
          <span className="jx-screen-examplesLabel">试试：</span>
          {EXAMPLE_SCREENS.map((ex) => (
            <LoaderButton key={ex.label} size="small" action={() => store.runExample(ex.spec)}>
              {ex.label}
            </LoaderButton>
          ))}
        </div>

        <SavedScreens />
        <div className="jx-screen-kbd">回车发送 · Shift+Space 换行</div>
      </div>
    </main>
  );
}, 'HeroSearch');

// Working-state top bar: the submitted prompt as a read-only bubble (+ edit), or a button to start one.
const WorkBar = complex.component(({ onEdit }: { onEdit: () => void }) => {
  const store = complex.useStore();
  return (
    <div className="jx-screen-workbar">
      {store.submittedPrompt ? (
        <div className="jx-screen-prompt" onClick={onEdit}>
          <FontAwesomeIcon icon={faWandMagicSparkles} className="jx-screen-promptIcon" />
          <span className="jx-screen-promptText">{store.submittedPrompt}</span>
          <Button
            type="text"
            size="small"
            className="jx-screen-promptEdit"
            icon={<FontAwesomeIcon icon={faPen} />}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            编辑
          </Button>
        </div>
      ) : (
        <Button icon={<FontAwesomeIcon icon={faWandMagicSparkles} />} onClick={onEdit}>
          AI 选股
        </Button>
      )}

      <div className="jx-screen-examples">
        {EXAMPLE_SCREENS.map((ex) => (
          <LoaderButton key={ex.label} size="small" action={() => store.runExample(ex.spec)}>
            {ex.label}
          </LoaderButton>
        ))}
      </div>
      <SavedScreens />
    </div>
  );
}, 'WorkBar');

// 我的选股 (手动存): only offer save when there's a current screen spec to save.
const SavedScreens = complex.component(() => {
  const store = complex.useStore();
  return (
    <span className="jx-screen-savedSlot">
      <SavedBar
        title="我的选股"
        items={store.savedLoader.result ?? []}
        loading={store.savedLoader.loading}
        onOpenList={() => store.loadSavedList()}
        onLoad={(id) => void store.openSaved(id)}
        onDelete={(id) => store.removeSaved(id)}
        save={
          store.spec
            ? { label: '保存选股', defaultName: '', onSave: (name) => store.saveCurrent(name) }
            : undefined
        }
      />
    </span>
  );
}, 'SavedScreens');

// Frosted modal to revise the prompt (背景虚化 · 透明白色) — same input behavior as the hero box.
const EditPromptModal = complex.component(
  ({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: () => void }) => {
    const store = complex.useStore();
    return (
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        title="选股 / 找标的"
        width={560}
        destroyOnHidden
        styles={{
          mask: {
            background: 'rgba(255, 255, 255, 0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          },
        }}
      >
        <div className="jx-screen-modalBox">
          <div className="jx-screen-modalField">
            <PromptInput
              value={store.nlText}
              onChange={(v) => store.setNlText(v)}
              onSubmit={onSubmit}
              placeholder="描述选股条件，或输入股票名称 / 代码"
              autoFocus
            />
          </div>
          <div className="jx-screen-modalFoot">
            <span className="jx-screen-kbd">回车发送 · Shift+Space 换行</span>
            <LoaderButton
              type="primary"
              loader={store.queryLoader}
              disabled={!store.nlText.trim()}
              action={onSubmit}
            >
              选股
            </LoaderButton>
          </div>
        </div>
      </Modal>
    );
  },
  'EditPromptModal',
);

// Prompt textarea: Enter sends; Shift+Space / Shift+Enter insert a newline; IME composition never sends.
function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // mid-IME (拼音候选) — let Enter confirm, never send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.shiftKey && e.code === 'Space') {
      // Shift+Space → newline at the caret (Shift+Enter falls through to the textarea's own newline).
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + '\n' + value.slice(end));
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1;
      });
    }
  };
  return (
    <Input.TextArea
      className="jx-screen-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoSize={{ minRows: 1, maxRows: 6 }}
      variant="borderless"
    />
  );
}

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
