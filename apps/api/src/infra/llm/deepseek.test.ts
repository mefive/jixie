import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolAwareMessage, ToolSpec } from './agent-llm.js';

const fetchMock = vi.fn<typeof fetch>();
let provider: typeof import('./deepseek.js');

const question = [{ role: 'user' as const, content: 'Return JSON with the number 3.' }];
const tool: ToolSpec = {
  name: 'read_sample',
  description: 'Read a synthetic sample.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
};

function completion(content: string | null) {
  return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
}

function streamResponse(deltas: unknown[]) {
  const frames = deltas.map((delta) => ({ choices: [{ index: 0, delta }] }));
  frames.push({ choices: [{ index: 0, delta: {} }] });
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
  // Split across UTF-8 bytes and SSE boundaries; the real SDK must assemble both correctly.
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 7) {
          controller.enqueue(bytes.slice(index, index + 7));
        }
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function requestBody(index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body));
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-test-key');
  vi.stubEnv('DEEPSEEK_BASE_URL', 'https://deepseek.fixture.invalid/v1');
  for (const name of [
    'DEEPSEEK_MODEL',
    'DEEPSEEK_AGENT_MODEL',
    'DEEPSEEK_AGENT_THINKING',
    'DEEPSEEK_REASONING_EFFORT',
  ]) {
    vi.stubEnv(name, undefined);
  }
  fetchMock.mockReset().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', fetchMock);
  provider = await import('./deepseek.js');
  // Provider failures are deterministic fixtures, so a retry adds no coverage.
  provider.deepseek().maxRetries = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('DeepSeek V4.1 wire contract', () => {
  it.each([
    [undefined, undefined, 'deepseek-flash', 'deepseek-flash'],
    ['custom-general', undefined, 'custom-general', 'custom-general'],
    ['custom-general', 'custom-agent', 'custom-general', 'custom-agent'],
    [undefined, 'custom-agent', 'deepseek-flash', 'custom-agent'],
    ['deepseek-chat', undefined, 'deepseek-chat', 'deepseek-chat'],
  ])(
    'uses model overrides %s / %s consistently',
    async (general, agent, expectedGeneral, expectedAgent) => {
      vi.stubEnv('DEEPSEEK_MODEL', general);
      vi.stubEnv('DEEPSEEK_AGENT_MODEL', agent);
      fetchMock.mockResolvedValueOnce(completion('{"value":3}'));
      fetchMock.mockResolvedValueOnce(completion('Synthetic title'));
      fetchMock.mockResolvedValueOnce(streamResponse([{ content: 'Answer.' }]));

      expect(await provider.chatJson(question)).toBe('{"value":3}');
      expect(await provider.chatText(question)).toBe('Synthetic title');
      expect(await provider.chatTools(question, [tool])).toMatchObject({ text: 'Answer.' });

      expect(requestBody(0)).toMatchObject({ model: expectedGeneral });
      expect(requestBody(1)).toMatchObject({ model: expectedGeneral });
      expect(requestBody(2)).toMatchObject({ model: expectedAgent });
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://deepseek.fixture.invalid/v1/chat/completions',
      );
    },
  );

  it('explicitly disables thinking for JSON and naming even when Agent effort is max', async () => {
    vi.stubEnv('DEEPSEEK_AGENT_THINKING', 'true');
    vi.stubEnv('DEEPSEEK_REASONING_EFFORT', 'max');
    fetchMock.mockResolvedValueOnce(completion('{"value":3}'));
    fetchMock.mockResolvedValueOnce(completion('Synthetic title'));

    await provider.chatJson(question);
    await provider.chatText(question);

    for (const index of [0, 1]) {
      expect(requestBody(index)).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0 });
      expect(requestBody(index)).not.toHaveProperty('reasoning_effort');
      expect(requestBody(index)).not.toHaveProperty('tools');
    }
    expect(requestBody(0)).toHaveProperty('response_format', { type: 'json_object' });
    expect(requestBody(1)).not.toHaveProperty('response_format');
  });

  it.each([undefined, 'low', 'high', 'max'])(
    'enables Agent thinking with effort %s',
    async (effort) => {
      vi.stubEnv('DEEPSEEK_REASONING_EFFORT', effort);
      fetchMock.mockResolvedValueOnce(streamResponse([{ content: 'Answer.' }]));

      await provider.chatTools(question, [tool]);

      expect(requestBody()).toMatchObject({
        stream: true,
        thinking: { type: 'enabled' },
        reasoning_effort: effort ?? 'high',
        tools: [{ type: 'function', function: tool }],
      });
      expect(requestBody()).not.toHaveProperty('temperature');
    },
  );

  it('explicitly disables Agent thinking and omits tools in repair rounds', async () => {
    vi.stubEnv('DEEPSEEK_AGENT_THINKING', 'false');
    vi.stubEnv('DEEPSEEK_REASONING_EFFORT', 'max');
    fetchMock.mockResolvedValueOnce(streamResponse([{ content: 'Repaired.' }]));

    await provider.chatTools(question, []);

    expect(requestBody()).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0 });
    expect(requestBody()).not.toHaveProperty('reasoning_effort');
    expect(requestBody()).not.toHaveProperty('tools');
  });

  it('keeps reasoning, Unicode and interleaved tool fragments through a tool-result round trip', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { reasoning_content: 'Inspect ' },
        { reasoning_content: 'the samples.' },
        {
          tool_calls: [
            { index: 1, id: 'call-b', function: { name: tool.name, arguments: '{"id":' } },
          ],
        },
        {
          tool_calls: [
            { index: 0, id: 'call-a', function: { name: tool.name, arguments: '{"id":"' } },
          ],
        },
        { tool_calls: [{ index: 1, function: { arguments: '"B"}' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '甲"}' } }] },
      ]),
    );
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { reasoning_content: 'Compare the returned values.' },
        { content: '差值' },
        { content: '是 3。' },
      ]),
    );
    const onDelta = vi.fn();
    const onReasoningDelta = vi.fn();
    const first = await provider.chatTools(question, [tool], { onDelta, onReasoningDelta });

    expect(first).toEqual({
      text: undefined,
      reasoningContent: 'Inspect the samples.',
      toolCalls: [
        { id: 'call-a', name: tool.name, args: '{"id":"甲"}' },
        { id: 'call-b', name: tool.name, args: '{"id":"B"}' },
      ],
    });
    expect(onDelta).not.toHaveBeenCalled();
    expect(onReasoningDelta.mock.calls.flat().join('')).toBe('Inspect the samples.');
    const followup: ToolAwareMessage[] = [
      ...question,
      {
        role: 'assistant',
        content: null,
        reasoningContent: first.reasoningContent,
        toolCalls: first.toolCalls,
      },
      { role: 'tool', toolCallId: 'call-a', content: '{"value":8}' },
      { role: 'tool', toolCallId: 'call-b', content: '{"value":5}' },
    ];
    const answer = await provider.chatTools(followup, [tool], { onDelta });

    expect(answer.text).toBe('差值是 3。');
    expect(onDelta.mock.calls.flat().join('')).toBe('差值是 3。');
    expect(requestBody(1).messages).toEqual([
      ...question,
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'Inspect the samples.',
        tool_calls: [
          {
            id: 'call-a',
            type: 'function',
            function: { name: tool.name, arguments: '{"id":"甲"}' },
          },
          {
            id: 'call-b',
            type: 'function',
            function: { name: tool.name, arguments: '{"id":"B"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-a', content: '{"value":8}' },
      { role: 'tool', tool_call_id: 'call-b', content: '{"value":5}' },
    ]);
  });

  it.each(['chatJson', 'chatText'] as const)('rejects empty %s output', async (method) => {
    fetchMock.mockResolvedValueOnce(completion(null));
    await expect(provider[method](question)).rejects.toThrow('DeepSeek returned empty content');
  });

  it('propagates provider rejection without producing a successful answer', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: 'Invalid model' } }, { status: 400 }),
    );
    await expect(provider.chatTools(question, [tool])).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('propagates cancellation to the upstream request', async () => {
    const controller = new AbortController();
    let requestEntered!: () => void;
    const entered = new Promise<void>((resolveEntered) => {
      requestEntered = resolveEntered;
    });
    let upstreamSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementationOnce(async (_url, options) => {
      upstreamSignal = options?.signal;
      return new Promise<Response>((_resolveResponse, rejectResponse) => {
        upstreamSignal?.addEventListener(
          'abort',
          () => rejectResponse(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        );
        requestEntered();
      });
    });
    const pending = provider.chatTools(question, [tool], { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'Error',
      message: 'Request was aborted.',
    });
    await entered;
    controller.abort();
    await rejected;
    expect(upstreamSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
