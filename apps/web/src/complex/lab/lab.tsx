import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import { Button, DatePicker, Input, InputNumber, Modal } from 'antd';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  faFolderOpen,
  faPaperPlane,
  faPlay,
  faPlus,
  faSpinner,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { LoaderButton } from '@src/components/loader-button';
import { complex } from './complex';
import './lab.css';

// Our dates are 'YYYYMMDD' strings; enable dayjs to parse that format for the DatePicker.
dayjs.extend(customParseFormat);
const ymd = (s: string) => (s ? dayjs(s, 'YYYYMMDD') : null);

const NavChart = lazy(() => import('./nav-chart'));
const CodeEditor = lazy(() => import('./code-editor'));
const TradeDetail = lazy(() => import('./trade-detail'));
const StrategyPicker = lazy(() => import('./strategy-picker'));

/**
 * Backtest workbench — code-first. The strategy is TypeScript the user writes against the SDK
 * (`defineStrategy` + `ctx`); the server compiles and runs it. Top strip = name/range/capital/run +
 * saved list; left = the code editor; right = results (metrics + equity curve) / live log.
 */
export const Lab = complex.component(() => {
  const store = complex.useStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [heroDismissed, setHeroDismissed] = useState(false); // "直接写代码" escape from the new-strategy hero
  const [newConfirm, setNewConfirm] = useState(false); // 新建 while dirty → confirm save first
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get('id');

  // Refresh / land on /lab → return to the last open strategy so work (and a running backtest) isn't lost.
  useEffect(() => {
    if (!id) {
      try {
        const cur = JSON.parse(localStorage.getItem('jx:lab:current') || '{}');
        if (cur.strategyId) setSearchParams({ id: cur.strategyId }, { replace: true });
      } catch {
        /* ignore */
      }
    }
    // mount-only: 新建 clears localStorage (writeCurrent({})) before navigating, so it won't bounce back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新建: blank strategy at /lab (clears the ?id=), reopening the hero. Guard unsaved edits first.
  const doNew = () => {
    store.newStrategy();
    setHeroDismissed(false);
    navigate('/lab');
  };
  const onNewClick = () => (store.dirty ? setNewConfirm(true) : doNew());
  const saveAndNew = async () => {
    await store.save();
    setNewConfirm(false);
    doNew();
  };

  return (
    <div className="jx-lab">
      <TopNav />

      <div className="jx-lab-bar">
        <label className="jx-lab-field jx-lab-field--name">
          <span className="jx-lab-label">策略名称</span>
          <Input
            value={store.name}
            onChange={(e) => store.setField('name', e.target.value)}
            placeholder="未命名（运行时自动命名）"
          />
        </label>
        <label className="jx-lab-field">
          <span className="jx-lab-label">起始日</span>
          <DatePicker
            className="jx-lab-control"
            value={ymd(store.start)}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => store.setField('start', d ? d.format('YYYYMMDD') : '')}
          />
        </label>
        <label className="jx-lab-field">
          <span className="jx-lab-label">结束日</span>
          <DatePicker
            className="jx-lab-control"
            value={ymd(store.end)}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => store.setField('end', d ? d.format('YYYYMMDD') : '')}
          />
        </label>
        <label className="jx-lab-field">
          <span className="jx-lab-label">初始资金</span>
          <InputNumber
            className="jx-lab-control"
            value={store.initialCash}
            min={10000}
            step={100000}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number((v ?? '').replace(/,/g, ''))}
            onChange={(v) => store.setField('initialCash', v ?? 0)}
          />
        </label>

        <div className="jx-lab-barActions">
          <Button icon={<FontAwesomeIcon icon={faPlus} />} onClick={onNewClick}>
            新建
          </Button>
          <Button
            icon={<FontAwesomeIcon icon={faFolderOpen} />}
            onClick={() => {
              store.loadSavedList();
              setPickerOpen(true);
            }}
          >
            我的策略
          </Button>
          <LoaderButton
            type="primary"
            icon={<FontAwesomeIcon icon={faPlay} />}
            loading={store.running}
            action={() => store.run()}
          >
            运行回测
          </LoaderButton>
        </div>
      </div>

      {store.isFresh && !heroDismissed ? (
        <StrategyHero onSkip={() => setHeroDismissed(true)} />
      ) : (
        <main className="jx-lab-body">
          <section className="jx-lab-editor">
            <NlBar />
            <StrategyCode />
          </section>
          <section className="jx-lab-result">
            <ResultPanel />
          </section>
        </main>
      )}

      <Suspense fallback={null}>
        <StrategyPicker
          open={pickerOpen}
          cards={store.savedLoader.result ?? []}
          loading={store.savedLoader.loading}
          onClose={() => setPickerOpen(false)}
          onLoad={(sid) => navigate(`/lab?id=${sid}`)}
          onDelete={(sid) => store.removeSaved(sid)}
        />
      </Suspense>

      <Modal
        open={newConfirm}
        title="当前策略尚未保存"
        onCancel={() => setNewConfirm(false)}
        footer={[
          <Button key="cancel" onClick={() => setNewConfirm(false)}>
            取消
          </Button>,
          <Button
            key="discard"
            danger
            onClick={() => {
              setNewConfirm(false);
              doNew();
            }}
          >
            不保存
          </Button>,
          <LoaderButton key="save" type="primary" action={saveAndNew} successMessage="已保存">
            保存并新建
          </LoaderButton>,
        ]}
      >
        <p>当前策略有未保存的修改。保存后将作为新版本，原先的回测结果会被清除。</p>
      </Modal>
    </div>
  );
}, 'Lab');

// —— 子组件 ——

// New-strategy hero: prompt-first entry (mirrors 选股看图). Describe the strategy → AI writes the code →
// the editor takes over (store.isFresh flips false). "直接写代码" skips straight to the editor.
const StrategyHero = complex.component(({ onSkip }: { onSkip: () => void }) => {
  const store = complex.useStore();
  return (
    <main className="jx-lab-hero">
      <div className="jx-lab-heroInner">
        <h1 className="jx-lab-heroTitle">新建策略</h1>
        <p className="jx-lab-heroHint">用一句话描述你的策略，AI 写成代码，再自己调参</p>

        <div className="jx-lab-heroBox">
          <PromptBox
            className="jx-lab-heroInput"
            value={store.nlText}
            onChange={(v) => store.setField('nlText', v)}
            onSubmit={() => void store.generate()}
            placeholder="如「每月买入股息率最高的 20 只，等权」「沪深300 里 ROE 大于 15% 的 30 只，每月调仓」"
            variant="borderless"
            autoFocus
          />
          <LoaderButton
            type="primary"
            shape="circle"
            className="jx-lab-heroSend"
            icon={<FontAwesomeIcon icon={faPaperPlane} />}
            loader={store.codegenLoader}
            disabled={!store.nlText.trim()}
            action={() => store.generate()}
          />
        </div>

        {store.codegenLoader.error && (
          <span className="jx-lab-nlError">{store.codegenLoader.errorObject?.message}</span>
        )}

        <div className="jx-lab-examples">
          <span className="jx-lab-examplesLabel">试试：</span>
          {EXAMPLE_PROMPTS.map((ex) => (
            <LoaderButton
              key={ex.label}
              size="small"
              action={() => {
                store.setField('nlText', ex.prompt);
                return store.generate();
              }}
            >
              {ex.label}
            </LoaderButton>
          ))}
        </div>

        <button type="button" className="jx-lab-heroSkip" onClick={onSkip}>
          或直接写代码 →
        </button>
      </div>
    </main>
  );
}, 'StrategyHero');

// NL→code: describe a strategy → the server writes (and compiles) TS → it drops into the editor.
const NlBar = complex.component(() => {
  const store = complex.useStore();
  return (
    <div className="jx-lab-nl">
      <PromptBox
        className="jx-lab-nlInput"
        value={store.nlText}
        onChange={(v) => store.setField('nlText', v)}
        onSubmit={() => void store.generate()}
        placeholder="用一句话描述策略，AI 写成代码，如「每月买入股息率最高的 20 只，等权」"
        autoSize={{ minRows: 1, maxRows: 3 }}
      />
      <LoaderButton
        icon={<FontAwesomeIcon icon={faWandMagicSparkles} />}
        loader={store.codegenLoader}
        disabled={!store.nlText.trim()}
        action={() => store.generate()}
      >
        AI 生成
      </LoaderButton>
      {store.codegenLoader.error && (
        <span className="jx-lab-nlError">{store.codegenLoader.errorObject?.message}</span>
      )}
    </div>
  );
}, 'NlBar');

// NL prompt textarea — Enter sends, Shift+Space / Shift+Enter newline, IME-safe (mirrors 选股看图).
function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  className,
  variant,
  autoSize,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  variant?: 'borderless' | 'outlined';
  autoSize?: { minRows: number; maxRows: number };
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoSize={autoSize ?? { minRows: 1, maxRows: 6 }}
      variant={variant}
    />
  );
}

// The strategy code editor — Monaco with SDK autocomplete/types, lazy-loaded into its own chunk.
const StrategyCode = complex.component(() => {
  const store = complex.useStore();
  return (
    <div className="jx-lab-code">
      <Suspense fallback={<div className="jx-lab-placeholder">加载编辑器…</div>}>
        <CodeEditor value={store.code} onChange={(v) => store.setField('code', v)} />
      </Suspense>
    </div>
  );
}, 'StrategyCode');

const ResultPanel = complex.component(() => {
  const store = complex.useStore();
  const [tradesOpen, setTradesOpen] = useState(false);

  if (store.running) {
    return <RunningLog lines={store.logLines} />;
  }
  if (store.error) {
    return <div className="jx-lab-placeholder jx-lab-placeholder--error">回测失败：{store.error}</div>;
  }
  const r = store.result; // a finished run, or the saved last-result loaded on reopen
  if (!r) {
    return <div className="jx-lab-placeholder">写好左侧策略后点「运行回测」查看净值与指标。</div>;
  }

  const up = r.totalReturn >= 0;
  const metrics: Metric[] = [
    { label: '年化收益', value: pct(r.annReturn), tone: r.annReturn >= 0 ? 'up' : 'down' },
    { label: '累计收益', value: pct(r.totalReturn), tone: up ? 'up' : 'down' },
    { label: 'Sharpe', value: r.sharpe.toFixed(2) },
    { label: '最大回撤', value: pct(r.maxDrawdown), tone: 'down' },
    { label: '期末权益', value: Math.round(r.finalValue).toLocaleString() },
    { label: '成交笔数', value: r.trades.toLocaleString() },
  ];

  return (
    <>
      <div className="jx-lab-metrics">
        {metrics.map((m) => (
          <div className="jx-lab-metric" key={m.label}>
            <div className="jx-lab-metricLabel">{m.label}</div>
            <div
              className={classNames('jx-lab-metricValue', {
                'text-up': m.tone === 'up',
                'text-down': m.tone === 'down',
              })}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>
      {(r.tradeLog?.length ?? 0) > 0 && (
        <div className="jx-lab-resultBar">
          <Button size="small" onClick={() => setTradesOpen(true)}>
            交易详情（{r.trades.toLocaleString()} 笔）
          </Button>
        </div>
      )}
      <Suspense fallback={<div className="jx-lab-placeholder">加载图表…</div>}>
        <NavChart nav={r.nav} up={up} />
      </Suspense>
      <Modal
        open={tradesOpen}
        onCancel={() => setTradesOpen(false)}
        footer={null}
        title="交易详情"
        width="94vw"
        style={{ top: 20 }}
        styles={{ body: { padding: 12 } }}
        destroyOnHidden
      >
        <Suspense fallback={<div className="jx-lab-placeholder">加载交易…</div>}>
          <TradeDetail tradeLog={r.tradeLog ?? []} start={r.start} end={r.end} />
        </Suspense>
      </Modal>
    </>
  );
}, 'ResultPanel');

// Live backtest progress — the worker's streamed log lines, auto-scrolled to the latest.
function RunningLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="jx-lab-running">
      <div className="jx-lab-runningHead">
        <FontAwesomeIcon icon={faSpinner} spin />
        <span>回测计算中…</span>
      </div>
      <pre ref={ref} className="jx-lab-log">
        {lines.length ? lines.join('\n') : '正在启动回测进程…'}
      </pre>
    </div>
  );
}

// —— 帮助函数 / 配置 ——

// Starter prompts for the new-strategy hero — short chip label + the full sentence sent to NL→code.
const EXAMPLE_PROMPTS = [
  { label: '高股息 20 只', prompt: '每月买入股息率最高的 20 只，等权' },
  { label: '沪深300 低估值', prompt: '沪深300 里 ROE 大于 15%、市盈率最低的 30 只，每月调仓，等权' },
  { label: '中证500 动量', prompt: '中证500 里 20 日动量最强的 20 只，每周轮动，等权' },
];

interface Metric {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}

function pct(x: number): string {
  return (x * 100).toFixed(2) + '%';
}
