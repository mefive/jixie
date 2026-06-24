import type { Expr } from '@jixie/shared';

/** A preset scoring factor the dropdown offers. Each carries the score expression, any precomputed
 * factor columns it needs, and the side that's "natural" for it (which the form preselects). */
export interface FactorPreset {
  key: string;
  label: string;
  score: Expr;
  factors?: string[];
  defaultSide: 'high' | 'low';
  hint: string;
}

const field = (name: string): Expr => ({ kind: 'field', name });
const factor = (name: string): Expr => ({ kind: 'factor', name });
const inv = (name: string): Expr => ({
  kind: 'binary',
  op: '/',
  left: { kind: 'const', value: 1 },
  right: field(name),
});

export const FACTOR_PRESETS: FactorPreset[] = [
  { key: 'ep', label: '盈利收益率 (1/PE_TTM)', score: inv('peTtm'), defaultSide: 'high', hint: '越高越便宜，买高' },
  { key: 'bp', label: '账面市值比 (1/PB)', score: inv('pb'), defaultSide: 'high', hint: '越高越便宜，买高' },
  { key: 'dv', label: '股息率 (%)', score: field('dvRatio'), defaultSide: 'high', hint: '高分红，买高' },
  {
    key: 'size',
    label: '规模 (ln 总市值)',
    score: { kind: 'unary', op: 'ln', arg: field('totalMv') },
    defaultSide: 'low',
    hint: '小市值溢价，买低',
  },
  { key: 'mom', label: '动量 (60日，跳5)', score: factor('mom'), factors: ['mom'], defaultSide: 'high', hint: '追强，买高' },
  { key: 'rev', label: '反转 (5日)', score: factor('rev'), factors: ['rev'], defaultSide: 'low', hint: 'A股反转，买低' },
  { key: 'vol', label: '波动率 (20日)', score: factor('vol'), factors: ['vol'], defaultSide: 'low', hint: '低波异象，买低' },
];

export const PRESET_BY_KEY: Record<string, FactorPreset> = Object.fromEntries(
  FACTOR_PRESETS.map((p) => [p.key, p]),
);
