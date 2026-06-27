import { describe, expect, it, vi } from 'vitest';
import { extractCode, nlToCode } from './nl-to-code.js';
import { buildCodegenPrompt } from './codegen-prompt.js';
import type { LlmCall } from '../../llm/nl-to-structured.js';

const GOOD = `export default defineStrategy({ name: 'x', watch: ['600519.SH'], onBar(ctx) { ctx.exit('600519.SH'); } });`;

describe('extractCode', () => {
  it('strips ```ts fences', () => {
    expect(extractCode('```ts\n' + GOOD + '\n```')).toBe(GOOD);
  });
  it('returns bare code unchanged (trimmed)', () => {
    expect(extractCode('\n' + GOOD + '\n')).toBe(GOOD);
  });
});

describe('buildCodegenPrompt', () => {
  it('documents the SDK + the no-import rule', () => {
    const p = buildCodegenPrompt();
    expect(p).toContain('ctx.select()');
    expect(p).toContain('defineStrategy');
    expect(p).toContain('不要写任何 import');
  });
});

describe('nlToCode (compile-validate + repair)', () => {
  it('compiles on the first try', async () => {
    const llm: LlmCall = vi.fn(async () => GOOD);
    const r = await nlToCode('清仓茅台', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.code).toContain('defineStrategy');
  });

  it('accepts fenced output', async () => {
    const llm: LlmCall = vi.fn(async () => '```typescript\n' + GOOD + '\n```');
    const r = await nlToCode('清仓茅台', llm);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(GOOD);
  });

  it('a non-compiling reply → error fed back → fixed', async () => {
    const bad = `export default defineStrategy({ onBar( {} );`; // syntax error
    const llm = vi.fn<LlmCall>().mockResolvedValueOnce(bad).mockResolvedValueOnce(GOOD);
    const r = await nlToCode('随便', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const repair = (llm.mock.calls[1][0] as { content: string }[]).map((m) => m.content).join('\n');
    expect(repair).toContain('无法编译');
  });

  it('a module with no onBar export is rejected and repaired', async () => {
    const noOnBar = `const x = 1;`;
    const llm = vi.fn<LlmCall>().mockResolvedValueOnce(noOnBar).mockResolvedValueOnce(GOOD);
    const r = await nlToCode('随便', llm);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it('always broken → ok=false with the last error', async () => {
    const llm: LlmCall = vi.fn(async () => `const x = ;`);
    const r = await nlToCode('随便', llm, 1);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.error).toBeTruthy();
  });
});
