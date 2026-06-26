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
 * The timing rules drawn as a decision flowchart — the if/elif/else branches as actual connected nodes.
 * Each rule is a decision (its `when`); a 是 edge leads to its action box, a 否 edge falls through to the
 * next rule; the final 否 lands on 不动. This is the "drill into the 择时 node" sub-view of the pipeline.
 */
export const TimingFlow = complex.component(({ onBack }: { onBack: () => void }) => {
  const store = complex.useStore();
  const rules = store.timingRules;

  const nodes: Node[] = [{ id: 'start', type: 'terminal', position: { x: 70, y: 0 }, data: { label: '每个 bar', kind: 'start' } }];
  const edges: Edge[] = [];

  rules.forEach((r, i) => {
    const y = 100 + i * 150;
    nodes.push({ id: `r${i}`, type: 'decision', position: { x: 0, y }, data: { tag: i === 0 ? '当' : '否则当', label: condText(r.when) } });
    nodes.push({ id: `a${i}`, type: 'action', position: { x: 320, y: y + 8 }, data: { label: actionsText(r.do) } });
    edges.push({ id: `yes${i}`, source: `r${i}`, sourceHandle: 'yes', target: `a${i}`, label: '是', type: 'smoothstep', style: EDGE });
    if (i > 0) edges.push({ id: `no${i - 1}`, source: `r${i - 1}`, sourceHandle: 'no', target: `r${i}`, label: '否', type: 'smoothstep', style: EDGE });
  });
  edges.push({ id: 'start-r0', source: 'start', target: 'r0', type: 'smoothstep', style: EDGE });

  const endY = 100 + rules.length * 150;
  nodes.push({ id: 'none', type: 'terminal', position: { x: 70, y: endY }, data: { label: '不动(等下一根)', kind: 'none' } });
  if (rules.length) {
    edges.push({ id: 'no-last', source: `r${rules.length - 1}`, sourceHandle: 'no', target: 'none', label: '否', type: 'smoothstep', style: EDGE });
  }

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

const EDGE = { stroke: '#c4c8cd' };

// —— 子组件 ——

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
