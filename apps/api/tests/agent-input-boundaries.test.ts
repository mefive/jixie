import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => ({
  strategy: vi.fn(),
  factor: vi.fn(),
  question: vi.fn(),
}));

vi.mock('#strategy/agent/turn.js', () => ({ startStrategyAgentTurn: operations.strategy }));
vi.mock('#factor/agent/turn.js', () => ({ startFactorAgentTurn: operations.factor }));
vi.mock('#factor/questions/conversations.js', () => ({
  startFactorQuestion: operations.question,
  readFactorQuestions: vi.fn(),
}));

import { strategyAgentRoute } from '#strategy/routes/agent.js';
import { factorAgentRoute } from '#factor/routes/agent.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', 'owner');
  await next();
});
app.route('/strategies', strategyAgentRoute);
app.route('/factors', factorAgentRoute);

const cases = [
  {
    name: 'Strategy Agent',
    path: '/strategies/path-strategy/agent/turns',
    operation: operations.strategy,
    body: { id: 'body-strategy', code: 'strategy code' },
    expected: { id: 'path-strategy', code: 'strategy code' },
  },
  {
    name: 'Factor Agent',
    path: '/factors/path-factor/agent/turns',
    operation: operations.factor,
    body: { id: 'body-factor', code: 'factor code' },
    expected: { id: 'path-factor', code: 'factor code' },
  },
  {
    name: 'Factor question',
    path: '/factors/questions',
    operation: operations.question,
    body: { factorKey: 'factor' },
    expected: { factorKey: 'factor' },
  },
];

function request(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': 'en' },
    body: JSON.stringify(body),
  });
}

describe.each(cases)('$name input boundary', ({ path, operation, body, expected }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    operation.mockResolvedValue({ turnId: 'turn' });
  });

  it('passes normalized input and default references to the business operation', async () => {
    const response = await request(`${path}?id=query-identity`, {
      ...body,
      message: '  Explain this  ',
    });

    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledExactlyOnceWith(
      'owner',
      { ...expected, message: 'Explain this', dataReferences: [] },
      'en',
    );
  });

  it.each([
    { message: '   ' },
    { message: 'x'.repeat(2001) },
    {
      message: 'Explain',
      dataReferences: [{ label: 'Invalid', method: 'invented_method', arguments: {} }],
    },
  ])('rejects invalid external input before calling business code', async (invalid) => {
    const response = await request(path, { ...body, ...invalid });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(operation).not.toHaveBeenCalled();
  });
});
