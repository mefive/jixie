import { useEffect, useState } from 'react';
import { Button, Dropdown, InputNumber, Select } from 'antd';
import {
  SCREEN_FIELDS,
  SCREEN_FIELD_BY_KEY,
  type ScreenField,
  type ScreenFilter,
  type ScreenOp,
  type ScreenSpec,
} from '@jixie/shared';
import { faPlus, faXmark, faArrowDownWideShort, faArrowUpShortWide } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './condition-chips.css';

interface Props {
  spec: ScreenSpec;
  onChange: (spec: ScreenSpec) => void; // any edit re-runs the deterministic query (no LLM)
}

/** Query-condition回显 + 行内编辑:改算子/值/增删条件、改排序,都直接重查(确定性,不过模型)。 */
export function ConditionChips({ spec, onChange }: Props) {
  const setFilter = (i: number, patch: Partial<ScreenFilter>) =>
    onChange({ ...spec, filters: spec.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const removeFilter = (i: number) =>
    onChange({ ...spec, filters: spec.filters.filter((_, j) => j !== i) });

  return (
    <div className="jx-chips">
      {spec.filters.map((f, i) => {
        const def = SCREEN_FIELD_BY_KEY[f.field];
        const scale = def?.scale ?? 1;
        return (
          <span key={`${f.field}-${i}`} className="jx-chips-chip">
            <span className="jx-chips-label">{def?.label ?? f.field}</span>
            <Select
              size="small"
              variant="borderless"
              value={f.op}
              onChange={(op) => setFilter(i, { op })}
              options={OP_OPTIONS}
              popupMatchSelectWidth={false}
            />
            <NumberInput value={f.value / scale} onApply={(n) => setFilter(i, { value: n * scale })} />
            {def?.unit && <span className="jx-chips-unit">{def.unit}</span>}
            <Button
              type="text"
              size="small"
              title="移除条件"
              icon={<FontAwesomeIcon icon={faXmark} />}
              onClick={() => removeFilter(i)}
            />
          </span>
        );
      })}

      <AddCondition spec={spec} onChange={onChange} />
      <SortControl spec={spec} onChange={onChange} />
    </div>
  );
}

// —— 子组件 / 帮助函数 ——

const OP_OPTIONS = [
  { label: '>', value: '>' },
  { label: '≥', value: '>=' },
  { label: '<', value: '<' },
  { label: '≤', value: '<=' },
] satisfies { label: string; value: ScreenOp }[];

// Sensible default condition when a field is added via「+加条件」(value in display units).
const ADD_DEFAULT: Partial<Record<ScreenField, { op: ScreenOp; value: number }>> = {
  pe: { op: '<', value: 20 },
  peTtm: { op: '<', value: 20 },
  pb: { op: '<', value: 1 },
  ps: { op: '<', value: 5 },
  dvRatio: { op: '>', value: 3 },
  totalMv: { op: '>', value: 500 }, // 亿
  circMv: { op: '>', value: 300 },
  turnoverRate: { op: '>', value: 3 },
  pctChg: { op: '>', value: 0 },
  close: { op: '<', value: 50 },
};

function AddCondition({ spec, onChange }: Props) {
  const used = new Set(spec.filters.map((f) => f.field));
  const avail = SCREEN_FIELDS.filter((f) => !used.has(f.key));
  if (!avail.length) return null;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: avail.map((f) => ({ key: f.key, label: f.unit ? `${f.label}(${f.unit})` : f.label })),
        onClick: ({ key }) => {
          const def = SCREEN_FIELD_BY_KEY[key];
          const d = ADD_DEFAULT[key as ScreenField] ?? { op: '<' as ScreenOp, value: 0 };
          onChange({
            ...spec,
            filters: [...spec.filters, { field: key as ScreenField, op: d.op, value: d.value * (def?.scale ?? 1) }],
          });
        },
      }}
    >
      <Button type="dashed" size="small" icon={<FontAwesomeIcon icon={faPlus} />}>
        加条件
      </Button>
    </Dropdown>
  );
}

function SortControl({ spec, onChange }: Props) {
  const sort = spec.sort;
  const dir = sort?.dir ?? 'desc';
  return (
    <span className="jx-chips-sort">
      <span className="jx-chips-sortLabel">排序</span>
      <Select
        size="small"
        variant="borderless"
        value={sort?.field ?? ''}
        placeholder="不排序"
        onChange={(field) =>
          onChange({ ...spec, sort: field ? { field: field as ScreenField, dir } : undefined })
        }
        options={[
          { label: '不排序', value: '' },
          ...SCREEN_FIELDS.map((f) => ({ label: f.label, value: f.key })),
        ]}
        popupMatchSelectWidth={false}
      />
      {sort && (
        <Button
          type="text"
          size="small"
          title={dir === 'desc' ? '从高到低' : '从低到高'}
          icon={<FontAwesomeIcon icon={dir === 'desc' ? faArrowDownWideShort : faArrowUpShortWide} />}
          onClick={() => onChange({ ...spec, sort: { field: sort.field, dir: dir === 'desc' ? 'asc' : 'desc' } })}
        />
      )}
    </span>
  );
}

/** Number input that commits only on blur / Enter (avoids re-querying on every keystroke). */
function NumberInput({ value, onApply }: { value: number; onApply: (n: number) => void }) {
  const [v, setV] = useState<number | null>(value);
  useEffect(() => setV(value), [value]);
  const apply = () => {
    if (v != null && Number.isFinite(v) && v !== value) onApply(v);
    else setV(value);
  };
  return (
    <InputNumber
      size="small"
      controls={false}
      variant="borderless"
      value={v}
      onChange={(n) => setV(n)}
      onBlur={apply}
      onPressEnter={apply}
      style={{ width: 56 }}
    />
  );
}
