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
});

describe('nlToScreen(校验 + 回灌重试)', () => {
  it('一次成功', async () => {
    const llm: LlmCall = vi.fn(async () => GOOD);
    const r = await nlToScreen('低估值大盘股', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.spec).toMatchObject({ sort: { field: 'totalMv', dir: 'desc' } });
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
