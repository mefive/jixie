import { Button, InputNumber, Select } from 'antd';
import { faPlus, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Condition, IndExpr, StateVar, TimingAction, TimingRule } from '@jixie/shared';
import { complex } from './complex';
import './timing-editor.css';

/**
 * Timing = a per-instrument rule state machine. This editor exposes it directly: declare scalar state
 * variables, then an ordered list of rules `当(全部满足) → 则(动作)` — the first matching rule fires
 * (if / elif / else). Operands are the indicator/price/state/持仓/权益 palette; nested arithmetic (e.g.
 * the Turtle equal-risk sizing) shows as a read-only formula (edit via IR/NL until a full expr editor).
 * Writes back to the lab-store, which is the single source of truth.
 */
export const TimingEditor = complex.component(() => {
  const store = complex.useStore();
  const on = store.timingOn;
  const rules = store.timingRules;
  const stateVars = store.timingState;
  const varNames = stateVars.map((v) => v.name);

  const setRules = (rs: TimingRule[]) => store.setField('timingRules', rs);
  const setVars = (vs: StateVar[]) => store.setField('timingState', vs);
  const patchRule = (i: number, r: TimingRule) => setRules(rules.map((x, j) => (j === i ? r : x)));

  return (
    <div className="jx-te">
      <label className="jx-te-toggle">
        <span className="jx-flow-fieldLabel">启用择时</span>
        <Select
          value={on ? 'on' : 'off'}
          onChange={(v) => store.setField('timingOn', v === 'on')}
          options={[
            { label: '不择时（选出即持有）', value: 'off' },
            { label: '启用规则', value: 'on' },
          ]}
        />
      </label>

      {on && (
        <>
          {/* state variables */}
          <div className="jx-te-section">
            <div className="jx-te-secHead">
              <span>状态变量(逐只)</span>
              <Button size="small" type="text" icon={<FontAwesomeIcon icon={faPlus} />}
                onClick={() => setVars([...stateVars, { name: `v${stateVars.length + 1}`, init: 0 }])} />
            </div>
            {stateVars.length === 0 && <div className="jx-flow-note">无(简单进出场不需要;海龟那种止损/加仓需要)。</div>}
            {stateVars.map((v, i) => (
              <div key={i} className="jx-te-var">
                <input className="jx-te-varName" value={v.name}
                  onChange={(e) => setVars(stateVars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <span className="jx-te-eq">初值</span>
                <InputNumber size="small" value={v.init}
                  onChange={(n) => setVars(stateVars.map((x, j) => (j === i ? { ...x, init: n ?? 0 } : x)))} />
                <Trash onClick={() => setVars(stateVars.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>

          {/* rules (if / elif / else) */}
          <div className="jx-te-section">
            <div className="jx-te-secHead">
              <span>规则(按序判,命中即停)</span>
              <Button size="small" type="text" icon={<FontAwesomeIcon icon={faPlus} />}
                onClick={() => setRules([...rules, newRule()])} />
            </div>
            {rules.map((r, i) => (
              <RuleEditor
                key={i}
                index={i}
                rule={r}
                varNames={varNames}
                onChange={(r2) => patchRule(i, r2)}
                onRemove={() => setRules(rules.filter((_, j) => j !== i))}
              />
            ))}
          </div>

          <label className="jx-flow-field">
            <span className="jx-flow-fieldLabel">掉出名单时</span>
            <Select
              value={store.membership}
              onChange={(v) => store.setField('membership', v as 'gate' | 'hard')}
              options={[
                { label: '留着(归离场管)', value: 'gate' },
                { label: '立即清仓', value: 'hard' },
              ]}
            />
          </label>
        </>
      )}
    </div>
  );
}, 'TimingEditor');

// —— 子组件 ——

function RuleEditor({
  index,
  rule,
  varNames,
  onChange,
  onRemove,
}: {
  index: number;
  rule: TimingRule;
  varNames: string[];
  onChange: (r: TimingRule) => void;
  onRemove: () => void;
}) {
  const compares = whenCompares(rule.when);
  const setCompares = (cs: Condition[]) => onChange({ ...rule, when: cs.length === 1 ? cs[0] : { kind: 'and', args: cs } });
  const setActions = (acts: TimingAction[]) => onChange({ ...rule, do: acts });

  return (
    <div className="jx-te-rule">
      <div className="jx-te-ruleHead">
        <span className="jx-te-ruleTag">{index === 0 ? '当' : '否则当'}(全部满足)</span>
        <Trash onClick={onRemove} />
      </div>
      {compares.map((c, i) => (
        <CompareRow
          key={i}
          compare={c}
          varNames={varNames}
          onChange={(c2) => setCompares(compares.map((x, j) => (j === i ? c2 : x)))}
          onRemove={() => setCompares(compares.filter((_, j) => j !== i))}
        />
      ))}
      <Button size="small" type="text" className="jx-te-add" icon={<FontAwesomeIcon icon={faPlus} />}
        onClick={() => setCompares([...compares, defaultCompare()])}>条件</Button>

      <div className="jx-te-ruleTag">则</div>
      {rule.do.map((a, i) => (
        <ActionRow
          key={i}
          action={a}
          varNames={varNames}
          onChange={(a2) => setActions(rule.do.map((x, j) => (j === i ? a2 : x)))}
          onRemove={() => setActions(rule.do.filter((_, j) => j !== i))}
        />
      ))}
      <Button size="small" type="text" className="jx-te-add" icon={<FontAwesomeIcon icon={faPlus} />}
        onClick={() => setActions([...rule.do, { kind: 'buy' }])}>动作</Button>
    </div>
  );
}

function CompareRow({
  compare,
  varNames,
  onChange,
  onRemove,
}: {
  compare: Condition;
  varNames: string[];
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  if (compare.kind !== 'compare') {
    return <div className="jx-flow-note">复合条件(and/or):{condText(compare)}</div>;
  }
  return (
    <div className="jx-te-row">
      <ValueEditor value={compare.left} varNames={varNames} onChange={(left) => onChange({ ...compare, left })} />
      <Select size="small" className="jx-te-op" value={compare.op} onChange={(op) => onChange({ ...compare, op })} options={CMP_OPS} />
      <ValueEditor value={compare.right} varNames={varNames} onChange={(right) => onChange({ ...compare, right })} />
      <Trash onClick={onRemove} />
    </div>
  );
}

function ActionRow({
  action,
  varNames,
  onChange,
  onRemove,
}: {
  action: TimingAction;
  varNames: string[];
  onChange: (a: TimingAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="jx-te-row">
      <Select size="small" className="jx-te-actKind" value={action.kind}
        onChange={(k) => onChange(defaultAction(k, varNames))} options={ACTION_KINDS} />
      {action.kind === 'order' && (
        <>
          <span className="jx-te-eq">股数</span>
          <ValueEditor value={action.shares} varNames={varNames} onChange={(shares) => onChange({ ...action, shares })} />
        </>
      )}
      {action.kind === 'set' && (
        <>
          <Select size="small" className="jx-te-varSel" value={action.var} onChange={(v) => onChange({ ...action, var: v })}
            options={varNames.map((n) => ({ label: n, value: n }))} />
          <span className="jx-te-eq">=</span>
          <ValueEditor value={action.value} varNames={varNames} onChange={(value) => onChange({ ...action, value })} />
        </>
      )}
      <Trash onClick={onRemove} />
    </div>
  );
}

/** A numeric operand. Leaves (价格/指标/数值/状态/持仓/权益) are editable; a nested arithmetic expr
 * (floor/min/…) shows read-only as a formula until a full expr editor exists. */
function ValueEditor({ value, varNames, onChange }: { value: IndExpr; varNames: string[]; onChange: (e: IndExpr) => void }) {
  if (value.kind === 'unary' || value.kind === 'binary') {
    return (
      <span className="jx-te-formula" title="复杂公式,暂只读">
        {indExprText(value)}
        <button className="jx-te-reset" title="改为数值" onClick={() => onChange({ kind: 'const', value: 0 })}>×</button>
      </span>
    );
  }
  const kind = value.kind;
  return (
    <span className="jx-te-operand">
      <Select size="small" value={kind} onChange={(k) => onChange(defaultOperand(k, varNames))} options={OPERAND_KINDS} />
      {value.kind === 'indicator' && (
        <>
          <Select size="small" value={value.name} onChange={(name) => onChange({ ...value, name })} options={IND_OPTS} />
          <Select size="small" value={value.field ?? 'close'} onChange={(field) => onChange({ ...value, field })} options={FIELD_OPTS} />
          <InputNumber size="small" className="jx-te-num" min={2} value={value.window} onChange={(w) => onChange({ ...value, window: w ?? 20 })} />
        </>
      )}
      {value.kind === 'const' && (
        <InputNumber size="small" className="jx-te-num" value={value.value} onChange={(v) => onChange({ kind: 'const', value: v ?? 0 })} />
      )}
      {value.kind === 'state' && (
        <Select size="small" className="jx-te-varSel" value={value.name} onChange={(name) => onChange({ kind: 'state', name })}
          options={(varNames.length ? varNames : [value.name]).map((n) => ({ label: n, value: n }))} />
      )}
    </span>
  );
}

function Trash({ onClick }: { onClick: () => void }) {
  return (
    <button className="jx-te-trash" title="删除" onClick={onClick}>
      <FontAwesomeIcon icon={faTrashCan} />
    </button>
  );
}

// —— 帮助函数 / 配置 ——

const CMP_OPS = ['>', '≥', '<', '≤', '=', '≠'].map((s, i) => ({ label: s, value: (['>', '>=', '<', '<=', '==', '!='] as const)[i] }));
const OPERAND_KINDS = [
  { label: '价格', value: 'price' },
  { label: '指标', value: 'indicator' },
  { label: '数值', value: 'const' },
  { label: '状态', value: 'state' },
  { label: '持仓股数', value: 'shares' },
  { label: '权益', value: 'equity' },
];
const ACTION_KINDS = [
  { label: '按仓位买入', value: 'buy' },
  { label: '下单(股数)', value: 'order' },
  { label: '清仓', value: 'exit' },
  { label: '设状态', value: 'set' },
];
const IND_OPTS = [
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
const IND_LABEL: Record<string, string> = { highest: '新高', lowest: '新低', sma: '均线', ema: 'EMA', atr: 'ATR' };

function defaultOperand(kind: string, varNames: string[]): IndExpr {
  switch (kind) {
    case 'indicator':
      return { kind: 'indicator', name: 'highest', field: 'high', window: 20 };
    case 'const':
      return { kind: 'const', value: 0 };
    case 'state':
      return { kind: 'state', name: varNames[0] ?? 'v1' };
    case 'shares':
      return { kind: 'shares' };
    case 'equity':
      return { kind: 'equity' };
    default:
      return { kind: 'price' };
  }
}

function defaultCompare(): Condition {
  return { kind: 'compare', op: '>', left: { kind: 'price' }, right: { kind: 'const', value: 0 } };
}

function defaultAction(kind: string, varNames: string[]): TimingAction {
  if (kind === 'order') return { kind: 'order', shares: { kind: 'const', value: 100 } };
  if (kind === 'exit') return { kind: 'exit' };
  if (kind === 'set') return { kind: 'set', var: varNames[0] ?? 'v1', value: { kind: 'const', value: 0 } };
  return { kind: 'buy' };
}

function newRule(): TimingRule {
  return { when: defaultCompare(), do: [{ kind: 'buy' }] };
}

/** Flatten a rule's `when` into a list of comparisons (treats a top-level AND as the list). */
function whenCompares(c: Condition): Condition[] {
  if (c.kind === 'and') return c.args;
  return [c];
}

function indExprText(e: IndExpr): string {
  switch (e.kind) {
    case 'const':
      return String(e.value);
    case 'price':
      return '价';
    case 'shares':
      return '持仓';
    case 'equity':
      return '权益';
    case 'state':
      return e.name;
    case 'indicator':
      return `${e.window}日${IND_LABEL[e.name] ?? e.name}`;
    case 'unary':
      return e.op === 'floor' ? `⌊${indExprText(e.arg)}⌋` : e.op === 'abs' ? `|${indExprText(e.arg)}|` : `−${indExprText(e.arg)}`;
    case 'binary': {
      const op = { '+': '+', '-': '−', '*': '×', '/': '÷', min: 'min', max: 'max' }[e.op];
      return e.op === 'min' || e.op === 'max'
        ? `${op}(${indExprText(e.left)}, ${indExprText(e.right)})`
        : `(${indExprText(e.left)} ${op} ${indExprText(e.right)})`;
    }
  }
}

export function condText(c: Condition): string {
  if (c.kind === 'and') return c.args.map(condText).join(' 且 ');
  if (c.kind === 'or') return c.args.map(condText).join(' 或 ');
  if (c.kind === 'not') return `非(${condText(c.arg)})`;
  const op = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '==': '=', '!=': '≠' }[c.op];
  return `${indExprText(c.left)} ${op} ${indExprText(c.right)}`;
}
