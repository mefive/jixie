import classNames from 'classnames';
import { Button } from 'antd';
import {
  Background,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TimingAction } from '@jixie/shared';
import { complex } from './complex';
import { condText, indExprText } from './timing-editor';
import './timing-flow.css';

/**
 * The timing rules drawn as a flowchart ladder. Timing is 命中即停 (first-match-wins): 是 ends the bar
 * (do the action, stop), 否 falls through to the next rule. So 否 — the only path that *continues* — is the
 * vertical spine (decisions stacked in one column, 否 threading straight down); 是 peels off to the right
 * into the action. Putting the repeating path (否) on the vertical axis keeps the chart growing *down*, never
 * drifting right however many rules there are. Every edge is a straight line — 否 vertical, 是 horizontal,
 * no bends. The drill-in sub-view of 择时.
 */
export const TimingFlow = complex.component(({ onBack }: { onBack: () => void }) => {
  const store = complex.useStore();
  const rules = store.timingRules;
  const n = rules.length;

  const nodes: Node[] = [{ id: 'start', type: 'terminal', position: { x: START_X, y: 0 }, data: { label: '每个 bar', kind: 'start' } }];
  const edges: Edge[] = [{ id: 'start-r0', source: 'start', target: 'r0', type: 'straight', style: EDGE }];

  rules.forEach((r, i) => {
    const y = TOP + i * STEP_Y;
    nodes.push({ id: `r${i}`, type: 'decision', position: { x: SPINE_X, y }, data: { tag: i === 0 ? '当' : '否则当', label: condText(r.when) } });
    // Drop the action ~half a decision-box lower so its Left handle is level with the decision's Right
    // handle → the 是 edge is a true horizontal line (the decision card is ~2 lines tall, the action ~1).
    nodes.push({ id: `a${i}`, type: 'action', position: { x: ACTION_X, y: y + ACTION_DROP }, data: { label: actionsText(r.do) } });
    edges.push({ id: `yes${i}`, source: `r${i}`, sourceHandle: 'yes', target: `a${i}`, label: '是', type: 'straight', style: EDGE, labelStyle: LABEL });
    if (i > 0) edges.push({ id: `no${i - 1}`, source: `r${i - 1}`, sourceHandle: 'no', target: `r${i}`, label: '否', type: 'straight', style: EDGE, labelStyle: LABEL });
  });

  // Final 否 (no rule matched) → 不动, at the foot of the spine.
  nodes.push({ id: 'none', type: 'terminal', position: { x: NONE_X, y: TOP + n * STEP_Y }, data: { label: '不动(等下一根)', kind: 'none' } });
  if (n) edges.push({ id: 'no-last', source: `r${n - 1}`, sourceHandle: 'no', target: 'none', label: '否', type: 'straight', style: EDGE, labelStyle: LABEL });

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={TIMING_NODES}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesDraggable={false}
      nodesConnectable={false}
      panOnScroll
    >
      <Background gap={16} color="#eef0f2" />
      <Panel position="top-left">
        <Button size="small" onClick={onBack}>
          ← 返回管线
        </Button>
      </Panel>
    </ReactFlow>
  );
}, 'TimingFlow');

// Ladder spacing: decisions share column SPINE_X, actions sit to the right at ACTION_X, one row STEP_Y apart.
const SPINE_X = 30;
const ACTION_X = 320;
const START_X = 92;
const NONE_X = 78;
const TOP = 80;
const STEP_Y = 132;
const ACTION_DROP = 10; // vertical nudge so the 是 edge lands level (decision ~2 lines, action ~1)
const EDGE = { stroke: '#c4c8cd' };
const LABEL = { fill: '#6b7280', fontSize: 12, fontWeight: 600 };

// —— 子组件 ——

// A decision: 否 drops out the bottom (spine, to the next rule); 是 exits the right (to its action).
function DecisionNode({ data }: NodeProps) {
  const d = data as unknown as { tag: string; label: string };
  return (
    <div className="jx-tf-decision">
      <Handle type="target" position={Position.Top} className="jx-tf-h" />
      <div className="jx-tf-tag">{d.tag}(全部满足)</div>
      <div className="jx-tf-decisionBody">{d.label}</div>
      <Handle type="source" position={Position.Right} id="yes" className="jx-tf-h" />
      <Handle type="source" position={Position.Bottom} id="no" className="jx-tf-h" />
    </div>
  );
}

function ActionNode({ data }: NodeProps) {
  const d = data as unknown as { label: string };
  return (
    <div className="jx-tf-action">
      <Handle type="target" position={Position.Left} className="jx-tf-h" />
      <div className="jx-tf-actionTag">则</div>
      <div className="jx-tf-actionBody">{d.label}</div>
    </div>
  );
}

function TerminalNode({ data }: NodeProps) {
  const d = data as unknown as { label: string; kind: string };
  return (
    <div className={classNames('jx-tf-terminal', { 'jx-tf-terminal--none': d.kind === 'none' })}>
      <Handle type="target" position={Position.Top} className="jx-tf-h" />
      {d.label}
      {d.kind === 'start' && <Handle type="source" position={Position.Bottom} className="jx-tf-h" />}
    </div>
  );
}

const TIMING_NODES = { decision: DecisionNode, action: ActionNode, terminal: TerminalNode };

// —— 帮助函数 ——

function actionsText(acts: TimingAction[]): string {
  return acts.map(actionText).join(' · ');
}

function actionText(a: TimingAction): string {
  if (a.kind === 'buy') return '按仓位买入';
  if (a.kind === 'exit') return '清仓';
  if (a.kind === 'order') return `下单 ${indExprText(a.shares)} 股`;
  return `设 ${a.var} = ${indExprText(a.value)}`;
}
