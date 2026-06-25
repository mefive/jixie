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
import type { Expr } from '@jixie/shared';
import { complex } from './complex';
import { FACTOR_PRESETS } from './presets';
import './strategy-flow.css';

/**
 * Visual projection of the cross-section strategy IR — a fixed-topology pipeline
 * (调仓·股票池 → 过滤 → 打分 → 选择 → 权重). Nodes render the live lab-store IR; clicking a node opens
 * its editor in the side panel, which writes back through the same store setters the form uses. So the
 * flowchart and the form are two editors over one source of truth (no second state), kept in sync by MobX.
 */
type StageKey = 'pool' | 'filter' | 'score' | 'pick' | 'weight';
const ORDER: StageKey[] = ['pool', 'filter', 'score', 'pick', 'weight'];
const TITLES: Record<StageKey, string> = {
  pool: '调仓 · 股票池',
  filter: '过滤',
  score: '打分',
  pick: '选择',
  weight: '权重',
};

const StrategyFlow = complex.component(() => {
  const store = complex.useStore();
  const [selected, setSelected] = useState<StageKey | null>('score');

  // Read the IR pieces (observed) → per-stage summary lines shown on each node.
  const lines: Record<StageKey, string[]> = {
    pool: [scheduleLabel(store.schedule), '全市场'],
    filter: [
      store.minListDays > 0 ? `剔次新 < ${store.minListDays} 天` : '不剔次新',
      store.dropIlliquidPct > 0 ? `剔流动性后 ${store.dropIlliquidPct}%` : '不剔流动性',
      ...(store.extraFilters.length ? [`${store.extraFilters.length} 条字段条件`] : []),
    ],
    score: [scoreFormula(store.score), presetLabel(store.selectedPresetKey)],
    pick: [store.side === 'high' ? '买高分位' : '买低分位', `分位 ${(store.quantile * 100).toFixed(0)}%`],
    weight: ['等权重'],
  };

  const nodes: Node[] = ORDER.map((k, i) => ({
    id: k,
    type: 'stage',
    position: { x: 0, y: i * 118 },
    draggable: false,
    data: { title: TITLES[k], lines: lines[k], active: selected === k },
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
  const d = data as unknown as { title: string; lines: string[]; active: boolean };
  return (
    <div className={classNames('jx-flow-node', { 'jx-flow-node--active': d.active })}>
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
  if (stage === 'score') {
    return (
      <EditorBox title="打分">
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
      </EditorBox>
    );
  }
  if (stage === 'pick') {
    return (
      <EditorBox title="选择">
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
  return (
    <EditorBox title="权重">
      <div className="jx-flow-note">v1 对选中的标的等权重持有。</div>
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

// —— 帮助函数 ——

function scheduleLabel(s: string): string {
  return s === 'monthly' ? '月度调仓' : s === 'weekly' ? '周度调仓' : '日度调仓';
}

function presetLabel(key: string): string {
  if (key === 'custom') return '自定义';
  return FACTOR_PRESETS.find((p) => p.key === key)?.label ?? key;
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
