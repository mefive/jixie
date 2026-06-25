/**
 * Generic NL→structured-JSON loop: call the model → extract JSON → validate → on failure feed the
 * errors back so the model self-corrects (≤ maxRepairs). The LLM call is injected (testable with a
 * mock, no key needed). Both NL→IR and NL→ScreenSpec are built on this. Pattern from fangtu.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LlmCall = (messages: ChatMessage[]) => Promise<string>;

/** A domain validator: turn an unknown parsed object into a typed value, or human-readable errors. */
export type Validator<T> = (obj: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };

export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  attempts: number; // model calls actually made
  errors?: string[]; // last errors when ok=false
  raw?: string; // last raw output when ok=false
}

/** Extract a JSON object from model output (tolerates ```json fences / surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) throw new Error('未找到 JSON 对象');
  return JSON.parse(body.slice(start, end + 1));
}

export async function parseStructured<T>(opts: {
  systemPrompt: string;
  userPrompt: string;
  validate: Validator<T>;
  llm: LlmCall;
  noun: string; // what we're producing, e.g. '策略 IR' / '查询 spec' (used in repair messages)
  maxRepairs?: number;
}): Promise<ParseResult<T>> {
  const { systemPrompt, userPrompt, validate, llm, noun, maxRepairs = 2 } = opts;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let attempts = 0;
  let lastErrors: string[] = [];
  let lastRaw = '';
  for (let i = 0; i <= maxRepairs; i++) {
    const text = await llm(messages);
    attempts++;
    lastRaw = text;

    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (e) {
      lastErrors = [`JSON 解析失败: ${(e as Error).message}`];
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `${lastErrors[0]}。请只输出一个合法的${noun} JSON 对象,不要任何解释。`,
      });
      continue;
    }

    const v = validate(parsed);
    if (v.ok) return { ok: true, value: v.value, attempts };

    lastErrors = v.errors;
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: `上面的${noun}校验失败:${v.errors.join('; ')}。请仅用白名单内的字段/算子/取值修正,只输出修正后的${noun} JSON。`,
    });
  }

  return { ok: false, attempts, errors: lastErrors, raw: lastRaw };
}
