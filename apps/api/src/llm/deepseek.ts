// DeepSeek client — the official openai SDK pointed at DeepSeek's OpenAI-compatible endpoint.
// chatJson (forced JSON) backs NL→screen; chatText (free text) backs NL→code.
// Config from .env: DEEPSEEK_API_KEY (required), DEEPSEEK_MODEL, DEEPSEEK_BASE_URL.
import OpenAI from 'openai';
import type { ChatMessage, LlmCall } from './nl-to-structured.js';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

let _client: OpenAI | null = null;

export function deepseek(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY(.env)');
  _client = new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE });
  return _client;
}

/** One chat completion forcing JSON output; returns raw message.content. Shape matches LlmCall so it
 * can be passed straight into nlToIr (production default; tests inject a mock instead). */
export const chatJson: LlmCall = async (messages: ChatMessage[]): Promise<string> => {
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const res = await deepseek().chat.completions.create({
    model,
    messages,
    temperature: 0, // NL→structured needs determinism
    response_format: { type: 'json_object' },
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 返回空 content');
  return content;
};

/** One chat completion returning free text — for NL→code (the output is a TS module, not JSON). Same
 * LlmCall shape so it feeds nlToCode (tests inject a mock instead). */
export const chatText: LlmCall = async (messages: ChatMessage[]): Promise<string> => {
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
  const res = await deepseek().chat.completions.create({ model, messages, temperature: 0 });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 返回空 content');
  return content;
};
