import { useState } from 'react';
import classNames from 'classnames';
import { InputNumber, Select } from 'antd';
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Condition, Expr, IndExpr, IndicatorName, PriceField, SizingMethod } from '@jixie/shared';
import { complex } from './complex';
import { FACTOR_PRESETS } from './presets';
import './strategy-flow.css';

/**
 * Visual projection of the strategy pipeline IR — a vertical stage flow
 * (调仓·股票池 → 过滤 → 打分·选择 → 择时 → 仓位). Nodes render the live lab-store; clicking a node opens
 * its editor in the side panel, which writes back through the same store setters the form uses. So the
 * flowchart and the form are two editors over one source of truth (no second state), kept in sync by MobX.
 * The 择时 node is optional — disabled until you add a timing rule.
 */
type StageKey = 'pool' | 'filter' | 'select' | 'timing' | 'sizing';
const ORDER: StageKey[] = ['pool', 'filter', 'select', 'timing', 'sizing'];
const TITLES: Record<StageKey, string> = {
  pool: '调仓 · 股票池',
  filter: '过滤',
  select: '打分 · 选择',
  timing: '择时',
  sizing: '仓位',
};

const StrategyFlow = complex.component(() => {
  const store = complex.useStore();
  const [selected, setSelected] = useState<StageKey | null>('select');
  const timingOn = store.timingOn;

  // Read the IR pieces (observed) → per-stage summary lines shown on each node.
  const lines: Record<StageKey, string[]> = {
    pool: [scheduleLabel(store.schedule), '全市场'],
    filter: [
      store.minListDays > 0 ? `剔次新 < ${store.minListDays} 天` : '不剔次新',
      store.dropIlliquidPct > 0 ? `剔流动性后 ${store.dropIlliquidPct}%` : '不剔流动性',
      ...(store.extraFilters.length ? [`${store.extraFilters.length} 条字段条件`] : []),
    ],
    select: [
      scoreFormula(store.score),
      `${store.side === 'high' ? '买高' : '买低'}分位 · 前 ${(store.quantile * 100).toFixed(0)}%`,
    ],
    timing: timingOn ? [`进 ${condText(store.entry)}`, `出 ${condText(store.exit)}`] : ['未启用'],
    sizing: [sizingLabel(store.sizingMethod)],
  };

  const nodes: Node[] = ORDER.map((k, i) => ({
    id: k,
    type: 'stage',
    position: { x: 0, y: i * 118 },
    draggable: false,
    data: { title: TITLES[k], lines: lines[k], active: selected === k, muted: k === 'timing' && !timingOn },
  }));
  const edges: Edge[] = ORDER.slice(1).map((k, i) => ({
    id: `${ORDER[i]}-${k}`,
    source: ORDER[i],
    target: k,
    type: 'smoothstep',
  }));

  return (
    <div className="jx-flow">
      <div className="jx-flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnScroll
          onNodeClick={(_e, n) => setSelected(n.id as StageKey)}
        >
          <Background gap={16} color="#eef0f2" />
        </ReactFlow>
      </div>
      <aside className="jx-flow-editor">
        {selected ? (
          <StageEditor stage={selected} />
        ) : (
          <div className="jx-flow-editorHint">点选左侧节点，在此编辑该步骤</div>
        )}
      </aside>
    </div>
  );
}, 'StrategyFlow');

export default StrategyFlow;

// —— 子组件 ——

// One pipeline stage, rendered as a card with top/bottom handles for the vertical edges.
function StageNode({ data }: NodeProps) {
  const d = data as unknown as { title: string; lines: string[]; active: boolean; muted: boolean };
  return (
    <div
      className={classNames('jx-flow-node', {
        'jx-flow-node--active': d.active,
        'jx-flow-node--muted': d.muted,
      })}
    >
      <Handle type="target" position={Position.Top} className="jx-flow-handle" />
      <div className="jx-flow-nodeTitle">{d.title}</div>
      {d.lines.map((l, i) => (
        <div key={i} className="jx-flow-nodeLine">
          {l}
        </div>
      ))}
      <Handle type="source" position={Position.Bottom} className="jx-flow-handle" />
    </div>
  );
}

const NODE_TYPES = { stage: StageNode };

// Side-panel editor for the selected stage. Reuses the same store setters as the left form, so edits
// reflect in both views. Observed so it re-renders as the IR changes.
const StageEditor = complex.component(({ stage }: { stage: StageKey }) => {
  const store = complex.useStore();

  if (stage === 'pool') {
    return (
      <EditorBox title="调仓 · 股票池">
        <Field label="调仓周期">
          <Select
            value={store.schedule}
            onChange={(v) => store.setField('schedule', v)}
            options={[
              { label: '月度', value: 'monthly' },
              { label: '周度', value: 'weekly' },
              { label: '日度', value: 'daily' },
            ]}
          />
        </Field>
        <div className="jx-flow-note">起点为全市场，按上方周期在每个调仓日重排。</div>
      </EditorBox>
    );
  }
  if (stage === 'filter') {
    return (
      <EditorBox title="过滤">
        <Field label="剔次新(天)">
          <InputNumber
            className="jx-flow-control"
            value={store.minListDays}
            min={0}
            onChange={(v) => store.setField('minListDays', v ?? 0)}
          />
        </Field>
        <Field label="剔流动性(%)">
          <InputNumber
            className="jx-flow-control"
            value={store.dropIlliquidPct}
            min={0}
            max={100}
            onChange={(v) => store.setField('dropIlliquidPct', v ?? 0)}
          />
        </Field>
        {store.extraFilters.length > 0 && (
          <div className="jx-flow-note">另有 {store.extraFilters.length} 条 AI 生成的字段条件（暂只读）。</div>
        )}
      </EditorBox>
    );
  }
  if (stage === 'select') {
    return (
      <EditorBox title="打分 · 选择">
        <Field label="打分因子">
          <Select
            value={store.selectedPresetKey}
            onChange={(v) => store.setPreset(v)}
            options={[
              ...FACTOR_PRESETS.map((p) => ({ label: p.label, value: p.key })),
              ...(store.selectedPresetKey === 'custom'
                ? [{ label: '自定义（来自 AI）', value: 'custom', disabled: true }]
                : []),
            ]}
          />
        </Field>
        <div className="jx-flow-formula">{scoreFormula(store.score)}</div>
        <Field label="方向">
          <Select
            value={store.side}
            onChange={(v) => store.setField('side', v)}
            options={[
              { label: '买高分位', value: 'high' },
              { label: '买低分位', value: 'low' },
            ]}
          />
        </Field>
        <Field label={`分位 (${(store.quantile * 100).toFixed(0)}%)`}>
          <InputNumber
            className="jx-flow-control"
            value={store.quantile}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(v) => store.setField('quantile', v ?? 0.1)}
          />
        </Field>
      </EditorBox>
    );
  }
  if (stage === 'timing') {
    const on = store.timingOn;
    return (
      <EditorBox title="择时">
        <Field label="启用择时">
          <Select
            value={on ? 'on' : 'off'}
            onChange={(v) => store.setField('timingOn', v === 'on')}
            options={[
              { label: '不择时（选出即持有）', value: 'off' },
              { label: '启用条件', value: 'on' },
            ]}
          />
        </Field>
        {on && (
          <>
            <div className="jx-flow-condLabel">进场条件(满足则买入)</div>
            <ConditionEditor value={store.entry} onChange={(c) => store.setField('entry', c)} />
            <div className="jx-flow-condLabel">离场条件(满足则卖出)</div>
            <ConditionEditor value={store.exit} onChange={(c) => store.setField('exit', c)} />
            <Field label="掉出名单时">
              <Select
                value={store.membership}
                onChange={(v) => store.setField('membership', v as 'gate' | 'hard')}
                options={[
                  { label: '留着(归离场管)', value: 'gate' },
                  { label: '立即清仓', value: 'hard' },
                ]}
              />
            </Field>
          </>
        )}
        <div className="jx-flow-note">逐只判:满足进场条件买入、满足离场条件卖出。</div>
      </EditorBox>
    );
  }
  // sizing
  const m = store.sizingMethod;
  return (
    <EditorBox title="仓位">
      <Field label="仓位方式">
        <Select
          value={m.kind}
          onChange={(v) => store.setField('sizingMethod', defaultSizing(v as SizingMethod['kind']))}
          options={[
            { label: '等权重', value: 'equal' },
            { label: '按权益百分比', value: 'equityPct' },
            { label: 'K 槽位等权', value: 'kSlots' },
          ]}
        />
      </Field>
      {m.kind === 'equityPct' && (
        <Field label="每只占权益(%)">
          <InputNumber
            className="jx-flow-control"
            min={1}
            max={100}
            value={Math.round(m.pct * 100)}
            onChange={(v) => store.setField('sizingMethod', { kind: 'equityPct', pct: (v ?? 20) / 100 })}
          />
        </Field>
      )}
      {m.kind === 'kSlots' && (
        <Field label="最多持仓数">
          <InputNumber
            className="jx-flow-control"
            min={1}
            value={m.k}
            onChange={(v) => store.setField('sizingMethod', { kind: 'kSlots', k: v ?? 10 })}
          />
        </Field>
      )}
    </EditorBox>
  );
}, 'StageEditor');

function EditorBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="jx-flow-editorBox">
      <div className="jx-flow-editorTitle">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="jx-flow-field">
      <span className="jx-flow-fieldLabel">{label}</span>
      {children}
    </label>
  );
}

// A single comparison: [operand] [op] [operand]. Both operands are pickable (价格/指标/数值), so any
// indicator-vs-price or indicator-vs-indicator condition is composable — no hardcoded preset.
function ConditionEditor({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  if (value.kind !== 'compare') return <div className="jx-flow-note">复合条件(暂不支持可视编辑)</div>;
  return (
    <div className="jx-flow-cond">
      <OperandEditor value={value.left} onChange={(left) => onChange({ ...value, left })} />
      <Select
        size="small"
        className="jx-flow-condOp"
        value={value.op}
        onChange={(op) => onChange({ ...value, op })}
        options={OP_OPTS}
      />
      <OperandEditor value={value.right} onChange={(right) => onChange({ ...value, right })} />
    </div>
  );
}

// One operand: 价格 / 指标(名 + 取价 + 窗口) / 数值.
function OperandEditor({ value, onChange }: { value: IndExpr; onChange: (e: IndExpr) => void }) {
  const kind = value.kind === 'indicator' ? 'indicator' : value.kind === 'const' ? 'const' : 'price';
  return (
    <div className="jx-flow-operand">
      <Select
        size="small"
        value={kind}
        onChange={(k) => onChange(defaultOperand(k as 'price' | 'indicator' | 'const'))}
        options={[
          { label: '价格', value: 'price' },
          { label: '指标', value: 'indicator' },
          { label: '数值', value: 'const' },
        ]}
      />
      {value.kind === 'indicator' && (
        <>
          <Select
            size="small"
            value={value.name}
            onChange={(name) => onChange({ ...value, name: name as IndicatorName })}
            options={INDICATOR_OPTS}
          />
          <Select
            size="small"
            value={value.field ?? 'close'}
            onChange={(field) => onChange({ ...value, field: field as PriceField })}
            options={FIELD_OPTS}
          />
          <InputNumber
            size="small"
            className="jx-flow-control"
            min={2}
            value={value.window}
            onChange={(w) => onChange({ ...value, window: w ?? 20 })}
          />
        </>
      )}
      {value.kind === 'const' && (
        <InputNumber
          size="small"
          className="jx-flow-control"
          value={value.value}
          onChange={(v) => onChange({ kind: 'const', value: v ?? 0 })}
        />
      )}
    </div>
  );
}

// —— 帮助函数 ——

function scheduleLabel(s: string): string {
  return s === 'monthly' ? '月度调仓' : s === 'weekly' ? '周度调仓' : '日度调仓';
}

function sizingLabel(m: SizingMethod): string {
  if (m.kind === 'equal') return '等权重';
  if (m.kind === 'equityPct') return `每只 ${Math.round(m.pct * 100)}% 权益`;
  return `最多 ${m.k} 仓等权`;
}

function defaultSizing(kind: SizingMethod['kind']): SizingMethod {
  if (kind === 'equityPct') return { kind: 'equityPct', pct: 0.2 };
  if (kind === 'kSlots') return { kind: 'kSlots', k: 10 };
  return { kind: 'equal' };
}

// —— timing condition editor options + summary ——
const OP_OPTS = [
  { label: '>', value: '>' },
  { label: '≥', value: '>=' },
  { label: '<', value: '<' },
  { label: '≤', value: '<=' },
];
const INDICATOR_OPTS = [
  { label: 'N日新高', value: 'highest' },
  { label: 'N日新低', value: 'lowest' },
  { label: 'N日均线', value: 'sma' },
  { label: 'N日EMA', value: 'ema' },
  { label: 'N日ATR', value: 'atr' },
];
const FIELD_OPTS = [
  { label: '开', value: 'open' },
  { label: '高', value: 'high' },
  { label: '低', value: 'low' },
  { label: '收', value: 'close' },
];
const INDICATOR_LABEL: Record<string, string> = {
  highest: '新高',
  lowest: '新低',
  sma: '均线',
  ema: 'EMA',
  atr: 'ATR',
};

function defaultOperand(kind: 'price' | 'indicator' | 'const'): IndExpr {
  if (kind === 'indicator') return { kind: 'indicator', name: 'highest', field: 'high', window: 20 };
  if (kind === 'const') return { kind: 'const', value: 0 };
  return { kind: 'price' };
}

function operandText(e: IndExpr): string {
  if (e.kind === 'price') return '价';
  if (e.kind === 'const') return String(e.value);
  if (e.kind === 'indicator') return `${e.window}日${INDICATOR_LABEL[e.name] ?? e.name}`;
  return '…'; // unary/binary not shown in the compact node summary
}

/** Compact one-line summary of a comparison, for the timing node card (e.g. 价 > 20日新高). */
function condText(c: Condition): string {
  if (c.kind !== 'compare') return '复合条件';
  const op = c.op === '>=' ? '≥' : c.op === '<=' ? '≤' : c.op;
  return `${operandText(c.left)} ${op} ${operandText(c.right)}`;
}

const FIELD_LABEL: Record<string, string> = {
  pe: '市盈率',
  peTtm: '市盈率TTM',
  pb: '市净率',
  ps: '市销率',
  psTtm: '市销率TTM',
  dvRatio: '股息率',
  dvTtm: '股息率TTM',
  totalMv: '总市值',
  circMv: '流通市值',
  turnoverRate: '换手率',
  adjClose: '收盘价',
};
const FACTOR_LABEL: Record<string, string> = { mom: '动量', rev: '反转', vol: '波动率' };
const OP_SYM: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** Render a score Expr AST as a readable formula (e.g. 股息率 ÷ 市盈率TTM). */
function exprText(e: Expr): string {
  switch (e.kind) {
    case 'const':
      return String(e.value);
    case 'field':
      return FIELD_LABEL[e.name] ?? e.name;
    case 'factor':
      return FACTOR_LABEL[e.name] ?? e.name;
    case 'unary': {
      const a = exprText(e.arg);
      return e.op === 'neg' ? `−${a}` : e.op === 'abs' ? `|${a}|` : `ln(${a})`;
    }
    case 'binary':
      return `(${exprText(e.left)} ${OP_SYM[e.op]} ${exprText(e.right)})`;
  }
}

function scoreFormula(e: Expr): string {
  const t = exprText(e);
  return t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1) : t;
}
