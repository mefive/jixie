import { describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt } from './nl-prompt.js';
import { extractJson, nlToIr, type LlmCall } from './nl-to-ir.js';

const EP_IR = JSON.stringify({
  schedule: 'monthly',
  stages: [
    { kind: 'universe', source: { type: 'all' } },
    { kind: 'filter', filters: [{ kind: 'minListDays', days: 365 }] },
    {
      kind: 'select',
      score: { kind: 'binary', op: '/', left: { kind: 'const', value: 1 }, right: { kind: 'field', name: 'peTtm' } },
      side: 'high',
      pick: { by: 'quantile', value: 0.1 },
    },
    { kind: 'sizing', method: { kind: 'equal' } },
  ],
});

describe('buildSystemPrompt(从因子注册表派生)', () => {
  const p = buildSystemPrompt();
  it('含 IR 结构与白名单关键项', () => {
    expect(p).toContain('stages'); // pipeline shape
    expect(p).toContain('peTtm'); // bar field whitelist
    expect(p).toContain('mom'); // factor column whitelist
    expect(p).toContain('minListDays'); // universe filter
  });
});

describe('extractJson', () => {
  it('裸 JSON', () => {
    expect(extractJson('{"schedule":"monthly"}')).toEqual({ schedule: 'monthly' });
  });
  it('```json 围栏', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('前后噪声', () => {
    expect(extractJson('好的:{"a":1} 以上')).toEqual({ a: 1 });
  });
  it('无 JSON 抛错', () => {
    expect(() => extractJson('没有对象')).toThrow();
  });
});

describe('nlToIr(校验 + 回灌重试)', () => {
  it('一次成功', async () => {
    const llm: LlmCall = vi.fn(async () => EP_IR);
    const r = await nlToIr('买最便宜的10%', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.ir).toMatchObject({ schedule: 'monthly', stages: expect.any(Array) });
  });

  it('首次非法 → 回灌错误 → 第二次修正成功', async () => {
    const bad = JSON.stringify({ schedule: 'yearly', stages: [{ kind: 'universe', source: { type: 'all' } }, { kind: 'sizing', method: { kind: 'equal' } }] });
    const llm = vi.fn<LlmCall>().mockResolvedValueOnce(bad).mockResolvedValueOnce(EP_IR);
    const r = await nlToIr('低估值', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const secondMsgs = (llm.mock.calls[1][0] as { content: string }[]).map((m) => m.content).join('\n');
    expect(secondMsgs).toContain('校验失败');
  });

  it('始终非法 → 用尽重试 ok=false 带 errors', async () => {
    const bad = JSON.stringify({ schedule: 'bad', stages: [{ kind: 'universe', source: { type: 'all' } }, { kind: 'sizing', method: { kind: 'equal' } }] });
    const llm: LlmCall = vi.fn(async () => bad);
    const r = await nlToIr('乱写', llm, 1);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2); // 1 + 1 repair
    expect(r.errors && r.errors.length).toBeGreaterThan(0);
  });

  it('JSON 解析失败也会重试', async () => {
    const llm = vi.fn<LlmCall>().mockResolvedValueOnce('这不是 json').mockResolvedValueOnce(EP_IR);
    const r = await nlToIr('随便', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });
});
