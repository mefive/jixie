import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStrategySchema } from '@jixie/shared/api/strategy';
import {
  factorCorrelationQuerySchema,
  factorQuestionHistorySchema,
} from '@jixie/shared/api/factor';
import { dataCatalogQuerySchema, embeddedListSchema } from '@jixie/shared/api/research';
import { strategyAgentBodySchema } from '#strategy/schema.js';

type Client = Record<string, (...arguments_: unknown[]) => Promise<unknown>>;
let client: Client;
let bundledInputs: string[];
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  // Exercise the real browser serializer with only locale dependencies replaced; no server is started.
  const result = await build({
    stdin: {
      contents: [
        "export * from './strategy';",
        "export * from './factor';",
        "export * from './research';",
        "export * from './research-embedded';",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('../../web/src/api', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    metafile: true,
    plugins: [
      {
        name: 'test-locale',
        setup(builder) {
          builder.onResolve({ filter: /^@src\/i18n(?:\/locale-store)?$/ }, (arguments_) => ({
            path: arguments_.path,
            namespace: 'test-locale',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'test-locale' }, () => ({
            contents:
              "export const localeStore = { locale: 'en' }; export default { t: key => key };",
            loader: 'js',
          }));
        },
      },
    ],
  });
  bundledInputs = Object.keys(result.metafile.inputs);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
  client = await import(/* @vite-ignore */ moduleUrl);
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function sentRequest() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [target, init] = fetchMock.mock.calls[0];
  return {
    url: new URL(String(target), 'http://localhost'),
    init,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
}

describe('Web requests consume the shared HTTP contracts', () => {
  it('keeps Zod and shared runtime validators out of the browser API client bundle', () => {
    expect(bundledInputs.some((filename) => /(?:zod|shared\/src\/api\/)/.test(filename))).toBe(
      false,
    );
  });

  it('preserves strategy creation payload and server-side naming', async () => {
    await client.createStrategy(
      {
        name: 'Client draft',
        code: 'export default {}',
        start: '20240101',
        end: '20241231',
        initialCash: 100_000,
      },
      '  Research strategy  ',
    );
    const sent = sentRequest();
    expect(sent.url.pathname).toBe('/api/app/strategies');
    expect(sent.init?.method).toBe('POST');
    expect(sent.body).not.toHaveProperty('name');
    expect(sent.body.prompt).toBe('  Research strategy  ');
    expect(createStrategySchema.parse(sent.body).prompt).toBe('Research strategy');
    expect(sent.init?.headers).toMatchObject({ 'accept-language': 'en' });
  });

  it('leaves optional Agent references for the server to default', async () => {
    await client.sendAgent('strategy-1', ' Explain ', 'code');
    const sent = sentRequest();
    expect(sent.url.pathname).toBe('/api/app/strategies/strategy-1/agent/turns');
    expect(sent.body).not.toHaveProperty('dataReferences');
    expect(strategyAgentBodySchema.parse(sent.body)).toMatchObject({
      message: 'Explain',
      dataReferences: [],
    });
  });

  it('serializes comma-separated correlation keys before server conversion', async () => {
    await client.getFactorCorrelation(['size', 'value'], 'month', '20200101', '20261231');
    const { url } = sentRequest();
    expect(url.searchParams.get('keys')).toBe('size,value');
    expect(factorCorrelationQuerySchema.parse(Object.fromEntries(url.searchParams))).toEqual({
      keys: ['size', 'value'],
      freq: 'month',
      start: '20200101',
      end: '20261231',
    });
  });

  it('preserves a zero pagination cursor without sending absent fields', async () => {
    await client.getFactorQuestions('size', 0);
    const { url } = sentRequest();
    expect(Object.fromEntries(url.searchParams)).toEqual({ before: '0' });
    expect(factorQuestionHistorySchema.parse(Object.fromEntries(url.searchParams))).toEqual({
      before: 0,
      limit: 40,
    });
  });

  it('round-trips spaces, Unicode, plus and ampersand in catalog queries', async () => {
    const query = '沪深 300 + gold & bonds';
    await client.searchResearchDataCatalog(query, undefined, undefined, 'datasets');
    const { url } = sentRequest();
    expect(url.searchParams.get('q')).toBe(query);
    expect(url.searchParams.has('assetType')).toBe(false);
    expect(dataCatalogQuerySchema.parse(Object.fromEntries(url.searchParams))).toEqual({
      q: query,
      scope: 'datasets',
      limit: 24,
    });
  });

  it('uses the shared embedded-analysis query while leaving pagination defaults to the API', async () => {
    await client.listEmbeddedAnalyses({ type: 'strategy', id: 'strategy-1' });
    const { url } = sentRequest();
    expect(Object.fromEntries(url.searchParams)).toEqual({
      hostType: 'strategy',
      hostId: 'strategy-1',
    });
    expect(embeddedListSchema.parse(Object.fromEntries(url.searchParams))).toEqual({
      hostType: 'strategy',
      hostId: 'strategy-1',
      limit: 20,
    });
  });
});
