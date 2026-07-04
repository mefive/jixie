import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ChatMessage } from '@jixie/shared';
import { useNavigate, useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import { Button, DatePicker, Input, InputNumber, Modal, Splitter, Tabs } from 'antd';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  faPaperPlane,
  faPlay,
  faPlus,
  faSpinner,
  faUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { LoaderButton } from '@src/components/loader-button';
import { LogView } from '@src/components/log-view';
import { Markdown } from '@src/components/markdown';
import { complex } from './complex';
import { MonthlyReturns } from './monthly-returns';
import { StrategyCardView } from './strategy-card';
import { readRecents } from './recents';
import './lab.css';

// Our dates are 'YYYYMMDD' strings; enable dayjs to parse that format for the DatePicker.
dayjs.extend(customParseFormat);
const ymd = (s: string) => (s ? dayjs(s, 'YYYYMMDD') : null);

const NavChart = lazy(() => import('./nav-chart'));
const CodeEditor = lazy(() => import('./code-editor'));
const TradeDetail = lazy(() => import('./trade-detail'));

/**
 * Backtest workbench — code-first, IDE-style. A first-time visit (no recents) opens a focused prompt
 * hero; otherwise 新建 pops a prompt modal over the workbench. The workbench is a 3-column Splitter: an
 * Agent panel (a chat that iterates on the strategy code, over a sticky 起始/结束/资金 + 运行回测 header;
 * plus a 历史 tab) | the code editor over a collapsible 日志 dock | a right column of 结果概览 / 交易明细
 * tabs (交易明细 = K线 over the trade table). All regions are drag-resizable.
 */
export const Lab = complex.component(() => {
  const store = complex.useStore();
  const [heroDismissed, setHeroDismissed] = useState(false); // "直接写代码" escape from the new-strategy hero
  const [newConfirm, setNewConfirm] = useState(false); // 新建 while dirty → confirm save first
  const [newModalOpen, setNewModalOpen] = useState(false); // 新建 → prompt modal (not the full hero)
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const skipFirstUrlSync = useRef(true);

  // store → URL: reflect the loaded strategy as ?id (replace — an auto-save/open shouldn't spam history).
  // This fires after run()/openSaved set savedId; a plain re-render, no remount.
  useEffect(() => {
    const savedId = store.savedId ?? '';
    if (savedId && (searchParams.get('id') ?? '') !== savedId) {
      setSearchParams({ id: savedId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.savedId]);

  // URL → store: external navigation (a 最近访问 card, 我的策略, browser back/forward) loads into the SAME
  // store instance — no remount, no flash. Skip the mount run (setup already resolved the initial URL).
  useEffect(() => {
    if (skipFirstUrlSync.current) {
      skipFirstUrlSync.current = false;
      return;
    }
    const id = searchParams.get('id') ?? '';
    const savedId = store.savedId ?? '';
    if (searchParams.has('new')) {
      if (savedId) {
        store.newStrategy();
      }
      return;
    }
    if (id) {
      if (id !== savedId) {
        void store.openSaved(id);
      }
      return;
    }
    // bare /lab (e.g. the 回测工作台 nav): re-open the most recent, else go blank.
    const recent = readRecents()[0] ?? '';
    if (recent && recent !== savedId) {
      void store.openSaved(recent);
    } else if (!recent && savedId) {
      store.newStrategy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 新建 → a prompt Modal (not the full 新增视图). Guard unsaved edits first.
  const openNewModal = () => (store.dirty ? setNewConfirm(true) : setNewModalOpen(true));
  // From the modal: start a new strategy with a first Agent message, or a blank one to hand-write. Both
  // reset to a fresh strategy and clear the URL (?new=1 keeps the URL sync from auto-opening a recent).
  const startNew = (text: string) => {
    setHeroDismissed(true);
    setNewModalOpen(false);
    store.newStrategy();
    void store.sendAgent(text);
    navigate('/lab?new=1', { replace: true });
  };
  const startBlank = () => {
    setHeroDismissed(true);
    setNewModalOpen(false);
    store.newStrategy();
    navigate('/lab?new=1', { replace: true });
  };
  const saveAndNew = async () => {
    await store.save();
    setNewConfirm(false);
    setNewModalOpen(true);
  };

  // The full-page 新增视图 (hero) shows only on a genuine first visit with nothing recent to auto-open;
  // otherwise 新建 pops the prompt modal over the workbench.
  const showHero = store.isFresh && !heroDismissed && readRecents().length === 0;

  return (
    <div className="jx-lab">
      <TopNav />

      {showHero ? (
        <StrategyHero
          onSubmit={(text) => void store.sendAgent(text)}
          onSkip={() => setHeroDismissed(true)}
        />
      ) : (
        // IDE layout: Agent | (编辑器 over 日志 dock) | 右列 结果/交易明细 tabs — all drag-resizable.
        <Splitter className="jx-lab-body">
          <Splitter.Panel defaultSize={380} min={300} max={620} collapsible>
            <AgentPanel onNew={openNewModal} />
          </Splitter.Panel>
          <Splitter.Panel min="22%">
            <Splitter orientation="vertical">
              <Splitter.Panel min="20%">
                <section className="jx-lab-editor">
                  <StrategyCode />
                </section>
              </Splitter.Panel>
              <Splitter.Panel defaultSize="28%" min="6%" collapsible>
                <LogDock />
              </Splitter.Panel>
            </Splitter>
          </Splitter.Panel>
          <Splitter.Panel min="24%">
            <ResultTabs />
          </Splitter.Panel>
        </Splitter>
      )}

      <NewStrategyModal
        open={newModalOpen}
        onSubmit={startNew}
        onBlank={startBlank}
        onCancel={() => setNewModalOpen(false)}
      />

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
              setNewModalOpen(true);
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

// New-strategy hero: the full-page 新增视图, shown only on a first visit with no recents. Describe the
// strategy → the Agent writes it → the workbench takes over. Below the prompt, 最近访问 tiles the
// last-opened strategies for one-click reopen.
const StrategyHero = complex.component(
  ({ onSubmit, onSkip }: { onSubmit: (text: string) => void; onSkip: () => void }) => {
    const store = complex.useStore();
    const navigate = useNavigate();
    // Snapshot the recent-id order on mount; the card data (name/snapshot) comes from the saved list.
    const [recentIds, setRecentIds] = useState(() => readRecents());
    const cards = store.savedLoader.result ?? [];
    const recentCards = recentIds
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is NonNullable<typeof card> => !!card)
      .slice(0, 6);

    return (
      <main className="jx-lab-hero">
        <div className="jx-lab-heroInner">
          <h1 className="jx-lab-heroTitle">新建策略</h1>
          <p className="jx-lab-heroHint">用一句话描述你的策略，AI 写成代码，再自己调参</p>

          <NewStrategyPrompt onSubmit={onSubmit} onSkip={onSkip} autoFocus />

          {recentCards.length > 0 && (
            <div className="jx-lab-recents">
              <span className="jx-lab-recentsLabel">最近访问</span>
              <div className="jx-lab-recentsGrid">
                {recentCards.map((card) => (
                  <StrategyCardView
                    key={card.id}
                    card={card}
                    onOpen={(id) => navigate(`/lab?id=${id}`)}
                    onDelete={(id) => {
                      store.removeSaved(id);
                      setRecentIds((ids) => ids.filter((existing) => existing !== id));
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  },
  'StrategyHero',
);

// The shared prompt block (hero + 新建 modal): a prompt box + example chips + a 直接写代码 escape.
// Local draft (not the store's chat draft) so the modal opens clean. onSubmit fires the first Agent turn.
const NewStrategyPrompt = complex.component(
  ({
    onSubmit,
    onSkip,
    autoFocus,
  }: {
    onSubmit: (text: string) => void;
    onSkip: () => void;
    autoFocus?: boolean;
  }) => {
    const [text, setText] = useState('');
    const submit = () => {
      const trimmed = text.trim();
      if (trimmed) {
        onSubmit(trimmed);
      }
    };
    return (
      <>
        <div className="jx-lab-heroBox">
          <PromptBox
            className="jx-lab-heroInput"
            value={text}
            onChange={setText}
            onSubmit={submit}
            placeholder="如「每月买入股息率最高的 20 只，等权」「沪深300 里 ROE 大于 15% 的 30 只，每月调仓」"
            variant="borderless"
            autoFocus={autoFocus}
          />
          <Button
            type="primary"
            shape="circle"
            className="jx-lab-heroSend"
            icon={<FontAwesomeIcon icon={faPaperPlane} />}
            disabled={!text.trim()}
            onClick={submit}
          />
        </div>

        <div className="jx-lab-examples">
          <span className="jx-lab-examplesLabel">试试：</span>
          {EXAMPLE_PROMPTS.map((ex) => (
            <Button key={ex.label} size="small" onClick={() => onSubmit(ex.prompt)}>
              {ex.label}
            </Button>
          ))}
        </div>

        <div className="jx-lab-heroLinks">
          <button type="button" className="jx-lab-heroSkip" onClick={onSkip}>
            或直接写代码 →
          </button>
          <a className="jx-lab-heroSkip" href="/learn" target="_blank" rel="noreferrer">
            第一次用?看入门教程 ↗
          </a>
        </div>
      </>
    );
  },
  'NewStrategyPrompt',
);

// 新建 → a prompt modal (ported from the hero) over the workbench, instead of the full 新增视图.
function NewStrategyModal({
  open,
  onSubmit,
  onBlank,
  onCancel,
}: {
  open: boolean;
  onSubmit: (text: string) => void;
  onBlank: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      title="新建策略"
      width={620}
      destroyOnHidden
    >
      <p className="jx-lab-heroHint">用一句话描述你的新策略，AI 写成代码，再自己调参</p>
      <NewStrategyPrompt onSubmit={onSubmit} onSkip={onBlank} autoFocus />
    </Modal>
  );
}

// —— Agent panel (left column) —— a chat that iterates on the strategy, over a sticky 运行配置; plus a
// 历史 tab to switch strategies. The agent edits the code in the middle editor; the user can still hand-edit.
const AgentPanel = complex.component(({ onNew }: { onNew: () => void }) => {
  const [tab, setTab] = useState('agent');
  return (
    <div className="jx-lab-agent">
      <Tabs
        className="jx-lab-agentTabs"
        size="small"
        activeKey={tab}
        onChange={setTab}
        tabBarExtraContent={
          <Button size="small" type="text" icon={<FontAwesomeIcon icon={faPlus} />} onClick={onNew}>
            新建
          </Button>
        }
        items={[
          { key: 'agent', label: 'Agent', children: <AgentChat /> },
          { key: 'history', label: '历史', children: <HistoryList /> },
        ]}
      />
    </div>
  );
}, 'AgentPanel');

// Agent tab: sticky 运行配置 (日期/资金 + 运行回测) over a scrollable chat log + a Cursor-style composer
// (a bordered box, no button — 回车发送; the box stays multi-row rather than collapsing to one line).
const AgentChat = complex.component(() => {
  const store = complex.useStore();
  return (
    <div className="jx-lab-chat">
      <RunConfig />
      <ChatLog messages={store.chatMessages} sending={store.sending} />
      <div className="jx-lab-chatInput">
        <PromptBox
          className="jx-lab-chatBox"
          value={store.nlText}
          onChange={(v) => store.setField('nlText', v)}
          onSubmit={() => void store.sendAgent(store.nlText)}
          placeholder="继续对话调整策略，如「加个 5% 止损」「改成周度调仓」— 回车发送"
          variant="borderless"
          autoSize={{ minRows: 3, maxRows: 10 }}
        />
      </div>
    </div>
  );
}, 'AgentChat');

// Sticky run-config header: 起始/结束/资金 + 运行回测 (策略名 is auto-generated on run — no name field).
const RunConfig = complex.component(() => {
  const store = complex.useStore();
  return (
    <div className="jx-lab-runConfig">
      <label className="jx-lab-runField">
        <span className="jx-lab-runLabel">起始</span>
        <DatePicker
          size="small"
          className="jx-lab-runControl"
          value={ymd(store.start)}
          format="YYYY-MM-DD"
          allowClear={false}
          onChange={(d) => store.setField('start', d ? d.format('YYYYMMDD') : '')}
        />
      </label>
      <label className="jx-lab-runField">
        <span className="jx-lab-runLabel">结束</span>
        <DatePicker
          size="small"
          className="jx-lab-runControl"
          value={ymd(store.end)}
          format="YYYY-MM-DD"
          allowClear={false}
          onChange={(d) => store.setField('end', d ? d.format('YYYYMMDD') : '')}
        />
      </label>
      <label className="jx-lab-runField">
        <span className="jx-lab-runLabel">资金</span>
        <InputNumber
          size="small"
          className="jx-lab-runControl"
          addonAfter="万"
          value={store.initialCash / 10000}
          min={1}
          step={10}
          formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          parser={(v) => Number((v ?? '').replace(/,/g, ''))}
          onChange={(v) => store.setField('initialCash', (v ?? 0) * 10000)}
        />
      </label>
      <LoaderButton
        type="primary"
        size="small"
        className="jx-lab-runBtn"
        icon={<FontAwesomeIcon icon={faPlay} />}
        loading={store.running}
        action={() => store.run()}
      >
        运行回测
      </LoaderButton>
    </div>
  );
}, 'RunConfig');

// Chat bubbles, auto-scrolled to the latest; a thinking row while an Agent turn is in flight.
function ChatLog({ messages, sending }: { messages: ChatMessage[]; sending: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, sending]);
  return (
    <div ref={ref} className="jx-lab-chatLog">
      {messages.length === 0 && !sending && (
        <div className="jx-lab-chatEmpty">
          跟 Agent 说你想要的策略，或让它改现有代码。改动会直接写进中间的编辑器。
        </div>
      )}
      {messages.map((message, index) => (
        <div key={index} className={classNames('jx-lab-bubble', `jx-lab-bubble--${message.role}`)}>
          {message.role === 'assistant' ? <Markdown text={message.content} /> : message.content}
        </div>
      ))}
      {sending && (
        <div className="jx-lab-bubble jx-lab-bubble--assistant jx-lab-bubble--thinking">
          <FontAwesomeIcon icon={faSpinner} spin /> 思考中…
        </div>
      )}
    </div>
  );
}

// 历史 tab: this user's strategies as vertical cards — open loads the strategy + its conversation.
const HistoryList = complex.component(() => {
  const store = complex.useStore();
  const navigate = useNavigate();
  const cards = store.savedLoader.result ?? [];
  if (store.savedLoader.loading && cards.length === 0) {
    return (
      <div className="jx-lab-placeholder">
        <FontAwesomeIcon icon={faSpinner} spin />
      </div>
    );
  }
  if (cards.length === 0) {
    return <div className="jx-lab-placeholder">还没有策略，跑一次回测会自动保存。</div>;
  }
  return (
    <div className="jx-lab-history">
      {cards.map((card) => (
        <StrategyCardView
          key={card.id}
          card={card}
          onOpen={(id) => navigate(`/lab?id=${id}`)}
          onDelete={(id) => store.removeSaved(id)}
        />
      ))}
    </div>
  );
}, 'HistoryList');

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
    if (e.nativeEvent.isComposing) {
      return;
    } // mid-IME (拼音候选) — let Enter confirm, never send
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

// 结果概览 — metrics + 净值 + 月度. Logs and 交易明细 live in the dock below (ResultDock), so this
// panel no longer swaps to a log view while running; it shows a running placeholder and lets the log
// stream in the dock.
const ResultPanel = complex.component(() => {
  const store = complex.useStore();

  if (store.running) {
    return (
      <div className="jx-lab-placeholder">
        <FontAwesomeIcon icon={faSpinner} spin />
        回测计算中…… 实时日志见下方「日志」
      </div>
    );
  }
  if (store.error) {
    return (
      <div className="jx-lab-placeholder jx-lab-placeholder--error">回测失败：{store.error}</div>
    );
  }
  const r = store.result; // a finished run, or the saved last-result loaded on reopen
  if (!r) {
    return <div className="jx-lab-placeholder">写好左侧策略后点「运行回测」查看净值与指标。</div>;
  }

  const up = r.totalReturn >= 0;
  const optPct = (v?: number) => (v == null ? '—' : pct(v));
  const optNum = (v?: number) => (v == null ? '—' : v.toFixed(2));
  const metrics: Metric[] = [
    { label: '年化收益', value: pct(r.annReturn), tone: r.annReturn >= 0 ? 'up' : 'down' },
    { label: '累计收益', value: pct(r.totalReturn), tone: up ? 'up' : 'down' },
    {
      label: '超额收益',
      value: optPct(r.excessReturn),
      tone: r.excessReturn == null ? undefined : r.excessReturn >= 0 ? 'up' : 'down',
    },
    { label: 'Sharpe', value: r.sharpe.toFixed(2) },
    { label: '信息比率', value: optNum(r.informationRatio) },
    { label: '最大回撤', value: pct(r.maxDrawdown), tone: 'down' },
    { label: 'Calmar', value: optNum(r.calmar) },
    { label: '胜率', value: optPct(r.winRate) },
    {
      label: '盈亏比',
      value:
        r.profitFactor == null ? '—' : r.profitFactor >= 99 ? '99+' : r.profitFactor.toFixed(2),
    },
    { label: '年换手', value: r.turnover == null ? '—' : `${r.turnover.toFixed(1)}×` },
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
      <Suspense fallback={<div className="jx-lab-placeholder">加载图表…</div>}>
        <NavChart nav={r.nav} up={up} />
      </Suspense>
      {r.monthly?.length ? <MonthlyReturns monthly={r.monthly} /> : null}
    </>
  );
}, 'ResultPanel');

// The bottom dock — a collapsible IDE-style panel with 日志 (streamed system + user console) and, once
// a run has trades, 交易明细 (K线 + trade list, in place — no modal). Running auto-selects 日志; the tab
// label spins while the worker streams.
const LogDock = complex.component(() => {
  const store = complex.useStore();
  const emptyText = store.running
    ? '正在启动回测进程…'
    : '运行策略后在此查看日志（系统进度 + 你的 console 输出）';
  return (
    <div className="jx-lab-dock">
      <div className="jx-lab-dockHead">
        {store.running && <FontAwesomeIcon icon={faSpinner} spin />}
        日志
      </div>
      <LogView lines={store.logLines} emptyText={emptyText} />
    </div>
  );
}, 'LogDock');

// Right column: 结果概览 (metrics + 净值 + 月度) / 交易明细 (K线 over the trade table) as tabs — no
// vertical split (that was too cramped). 交易明细 appears only once a run has trades.
const ResultTabs = complex.component(() => {
  const store = complex.useStore();
  const [active, setActive] = useState('overview');
  const result = store.result;
  const hasTrades = (result?.tradeLog?.length ?? 0) > 0;

  const items = [
    {
      key: 'overview',
      label: '结果概览',
      children: (
        <div className="jx-lab-result">
          <ResultPanel />
        </div>
      ),
    },
  ];
  if (hasTrades && result) {
    items.push({
      key: 'trades',
      label: `交易明细（${result.trades.toLocaleString()} 笔）`,
      children: (
        <div className="jx-lab-tradesTab">
          <Suspense fallback={<div className="jx-lab-placeholder">加载交易…</div>}>
            <TradeDetail
              tradeLog={result.tradeLog ?? []}
              start={result.start}
              end={result.end}
              nav={result.nav}
            />
          </Suspense>
        </div>
      ),
    });
  }

  // A tab may vanish (a rerun with no trades) — fall back to 结果概览 so the panel never blanks.
  const activeKey = active === 'trades' && !hasTrades ? 'overview' : active;

  return (
    <div className="jx-lab-resultTabs">
      <Tabs
        className="jx-lab-resultTabsInner"
        size="small"
        activeKey={activeKey}
        onChange={setActive}
        items={items}
        tabBarExtraContent={
          hasTrades && store.savedId ? (
            <Button
              size="small"
              type="text"
              icon={<FontAwesomeIcon icon={faUpRightFromSquare} />}
              onClick={() => window.open(`/trades?id=${store.savedId}`, '_blank')}
            >
              页面打开
            </Button>
          ) : null
        }
      />
    </div>
  );
}, 'ResultTabs');

// —— 帮助函数 / 配置 ——

// Starter prompts for the new-strategy hero — short chip label + the full sentence sent to NL→code.
const EXAMPLE_PROMPTS = [
  { label: '高股息 20 只', prompt: '每月买入股息率最高的 20 只，等权' },
  {
    label: '沪深300 低估值',
    prompt: '沪深300 里 ROE 大于 15%、市盈率最低的 30 只，每月调仓，等权',
  },
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
