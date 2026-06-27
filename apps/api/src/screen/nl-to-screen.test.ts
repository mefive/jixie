import { describe, expect, it, vi } from 'vitest';
import { buildScreenPrompt } from './nl-prompt.js';
import { nlToScreen } from './nl-to-screen.js';
import type { LlmCall } from '../llm/nl-to-structured.js';

const GOOD = JSON.stringify({
  filters: [{ field: 'peTtm', op: '<', value: 15 }],
  sort: { field: 'totalMv', dir: 'desc' },
  limit: 20,
});

describe('buildScreenPrompt', () => {
  it('含字段白名单与单位约定', () => {
    const p = buildScreenPrompt();
    expect(p).toContain('totalMv');
    expect(p).toContain('dvRatio');
    expect(p).toContain('万元'); // unit note
  });

  it('含标的查找(lookup)说明', () => {
    const p = buildScreenPrompt();
    expect(p).toContain('lookup');
    expect(p).toContain('绝不编造代码');
  });
});

describe('nlToScreen(校验 + 回灌重试)', () => {
  it('选股一次成功', async () => {
    const llm: LlmCall = vi.fn(async () => GOOD);
    const r = await nlToScreen('低估值大盘股', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.parse).toMatchObject({ kind: 'screen', spec: { sort: { field: 'totalMv', dir: 'desc' } } });
  });

  it('点名股票 → lookup(规范化名称)', async () => {
    const llm: LlmCall = vi.fn(async () => JSON.stringify({ lookup: ['工商银行', '贵州茅台'] }));
    const r = await nlToScreen('工行和茅台', llm);
    expect(r.ok).toBe(true);
    expect(r.parse).toEqual({ kind: 'lookup', names: ['工商银行', '贵州茅台'] });
  });

  it('lookup 为空 → 回灌 → 修正为选股', async () => {
    const bad = JSON.stringify({ lookup: [] });
    const llm = vi.fn<LlmCall>().mockResolvedValueOnce(bad).mockResolvedValueOnce(GOOD);
    const r = await nlToScreen('?', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.parse?.kind).toBe('screen');
  });

  it('未知字段 → 回灌 → 修正', async () => {
    const bad = JSON.stringify({ filters: [{ field: 'roe', op: '<', value: 10 }] });
    const llm = vi.fn<LlmCall>().mockResolvedValueOnce(bad).mockResolvedValueOnce(GOOD);
    const r = await nlToScreen('roe 低', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const secondMsgs = (llm.mock.calls[1][0] as { content: string }[]).map((m) => m.content).join('\n');
    expect(secondMsgs).toContain('校验失败');
  });

  it('始终非法 → ok=false', async () => {
    const llm: LlmCall = vi.fn(async () => JSON.stringify({ filters: [{ field: 'x', op: '<', value: 1 }] }));
    const r = await nlToScreen('乱写', llm, 1);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
  });
});
