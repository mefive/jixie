import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkBackendBoundaries,
  collectBackendDependencies,
  inspectBackendBoundaries,
} from './check-backend-boundaries.mjs';

function fixture(context, sources, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jixie-boundaries-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'apps/api/tsconfig.json': JSON.stringify({
      compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext', ...config },
    }),
    ...sources,
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}
const rules = (result) => result.diagnostics.map((issue) => issue.rule);
const src = 'apps/api/src/';
const emptyPolicy = { edges: [], cycles: [] };

test('scans package-level tests and permits their application composition imports', (context) => {
  const root = fixture(context, {
    [src + 'bootstrap.ts']: 'export const registry = {};',
    'apps/api/tests/support.ts': "export { registry } from '../src/bootstrap.js';",
    'apps/api/tests/lifecycle.integration.test.ts': "import { registry } from './support.js';",
  });
  const dependencies = collectBackendDependencies(root);
  assert.ok(dependencies.files.includes('apps/api/tests/lifecycle.integration.test.ts'));
  assert.ok(dependencies.files.includes('apps/api/tests/support.ts'));
  assert.equal(dependencies.edges.length, 2);
  assert.ok(dependencies.edges.every((edge) => edge.internal));
  assert.deepEqual(inspectBackendBoundaries(dependencies, emptyPolicy).diagnostics, []);
});

test('checks syntax and unresolved imports inside package-level tests', (context) => {
  const root = fixture(context, {
    'apps/api/tests/invalid.test.ts': "import './missing.js'; export const = ;",
  });
  const result = collectBackendDependencies(root);
  assert.ok(rules(result).includes('syntax'));
  assert.ok(rules(result).includes('unresolved-import'));
  assert.ok(result.diagnostics.every((issue) => issue.from === 'apps/api/tests/invalid.test.ts'));
});

test('rejects production dependencies on package-level test helpers', (context) => {
  const root = fixture(context, {
    [src + 'strategy/action.ts']: "import { value } from '../../tests/support.js';",
    'apps/api/tests/support.ts': 'export const value = 1;',
  });
  const result = checkBackendBoundaries(root, emptyPolicy);
  assert.deepEqual(rules(result), ['production-test-dependency']);
});

test('keeps HTTP in adapters while permitting direct Prisma in business operations', (context) => {
  const root = fixture(context, {
    [src + 'strategy/routes.ts']:
      "import { Hono } from 'hono'; import { save } from './definitions/save.js'; export const routes = new Hono(); save();",
    [src + 'strategy/definitions/save.ts']:
      "import { prisma } from '../../infra/database/prisma.js'; export const save = () => prisma;",
    [src + 'infra/database/prisma.ts']: 'export const prisma = {};',
  });
  assert.deepEqual(checkBackendBoundaries(root, emptyPolicy).diagnostics, []);
});

test('permits root auth HTTP adapters while keeping session storage in business code', (context) => {
  const root = fixture(context, {
    [src + 'auth/routes.ts']:
      "import { Hono } from 'hono'; import './cookies.js'; import './session.js'; export const routes = new Hono();",
    [src + 'auth/cookies.ts']:
      "import type { Context } from 'hono'; import { getCookie } from 'hono/cookie';",
    [src + 'auth/middleware.ts']:
      "import type { MiddlewareHandler } from 'hono'; import './cookies.js'; import './session.js';",
    [src + 'auth/session.ts']: "import { prisma } from '../infra/database/prisma.js';",
    [src + 'infra/database/prisma.ts']: 'export const prisma = {};',
  });
  assert.deepEqual(checkBackendBoundaries(root, emptyPolicy).diagnostics, []);
});

test('rejects auth business dependencies on HTTP adapters and direct adapter storage', (context) => {
  const root = fixture(context, {
    [src + 'auth/session.ts']:
      "import type { Context } from 'hono'; import './cookies.js'; import './middleware.js';",
    [src + 'auth/cookies.ts']: "import { prisma } from '../infra/database/prisma.js';",
    [src + 'auth/middleware.ts']: "import { prisma } from '../infra/database/prisma.js';",
    [src + 'infra/database/prisma.ts']: 'export const prisma = {};',
  });
  const result = checkBackendBoundaries(root, emptyPolicy);
  assert.equal(result.diagnostics.filter((issue) => issue.rule === 'http-ownership').length, 1);
  assert.equal(result.diagnostics.filter((issue) => issue.rule === 'http-direction').length, 2);
  assert.equal(result.diagnostics.filter((issue) => issue.rule === 'http-storage').length, 2);
});

test('classifies type imports, mixed bindings, type queries, re-exports and literal dynamic imports', (context) => {
  const root = fixture(context, {
    [src + 'factor/operation.ts']: [
      "import type { Contract } from './contract.js';",
      "import { type Contract as Alias } from './contract.js';",
      "import { type Contract as Mixed, value } from './contract.js';",
      "export type { Contract as Exported } from './contract.js';",
      "export { value } from './contract.js';",
      "type Queried = import('./contract.js').Contract;",
      'void import(`./contract.js`);',
    ].join('\n'),
    [src + 'factor/contract.ts']: 'export interface Contract {} export const value = 1;',
  });
  const dependencies = collectBackendDependencies(root);
  assert.deepEqual(
    dependencies.edges.map((edge) => [edge.kind, edge.form]),
    [
      ['type', 'import'],
      ['type', 'import'],
      ['runtime', 'import'],
      ['type', 're-export'],
      ['runtime', 're-export'],
      ['type', 'import-type'],
      ['runtime', 'dynamic-import'],
    ],
  );
  assert.ok(dependencies.edges.every((edge) => edge.to === src + 'factor/contract.ts'));
});

test('resolves TypeScript path aliases before enforcing module ownership', (context) => {
  const root = fixture(
    context,
    {
      [src + 'infra/jobs/example.ts']: "export { value } from '@business/model';",
      [src + 'strategy/model.ts']: 'export const value = 1;',
    },
    { baseUrl: '.', paths: { '@business/*': ['src/strategy/*'] } },
  );
  assert.ok(rules(checkBackendBoundaries(root, emptyPolicy)).includes('infra-direction'));
});

test('checks runtime, type-only and dynamic imports equally for ownership', (context) => {
  const root = fixture(context, {
    [src + 'market/read.ts']:
      "import type { Contract } from '../strategy/contract.js'; void import('../research/action.js');",
    [src + 'strategy/contract.ts']: 'export interface Contract {}',
    [src + 'research/action.ts']: 'export const value = 1;',
  });
  const result = checkBackendBoundaries(root, emptyPolicy);
  assert.deepEqual(
    result.diagnostics
      .filter((issue) => issue.rule === 'market-direction')
      .map((issue) => issue.kind),
    ['type', 'runtime'],
  );
});

test('resolves native package imports to source and enforces module ownership', (context) => {
  const root = fixture(
    context,
    {
      'apps/api/package.json': JSON.stringify({
        type: 'module',
        imports: {
          '#strategy/*': {
            development: './src/strategy/*',
            default: './dist/src/strategy/*',
          },
        },
      }),
      [src + 'infra/jobs/example.ts']: "export { value } from '#strategy/model.js';",
      [src + 'strategy/model.ts']: 'export const value = 1;',
    },
    { customConditions: ['development'] },
  );
  const result = checkBackendBoundaries(root, emptyPolicy);
  assert.ok(rules(result).includes('infra-direction'));
  const dependencies = collectBackendDependencies(root);
  assert.equal(dependencies.edges[0].to, src + 'strategy/model.ts');
  assert.deepEqual(dependencies.diagnostics, []);
});

test('rejects unknown and missing native internal imports', (context) => {
  const root = fixture(context, {
    'apps/api/package.json': JSON.stringify({
      imports: { '#infra/*': './src/infra/*' },
    }),
    [src + 'factor/read.ts']: "import '#unknown/module.js'; void import('#infra/missing.js');",
  });
  assert.deepEqual(rules(collectBackendDependencies(root)), [
    'unresolved-import',
    'unresolved-import',
  ]);
});

test('rejects direct HTTP storage and business imports of HTTP adapters', (context) => {
  const root = fixture(context, {
    [src + 'strategy/routes.ts']: "import { prisma } from '../infra/database/prisma.js';",
    [src + 'strategy/save.ts']:
      "import type { Context } from 'hono'; import '../infra/http/errors.js';",
    [src + 'infra/database/prisma.ts']: 'export const prisma = {};',
    [src + 'infra/http/errors.ts']: 'export const value = 1;',
  });
  const found = rules(checkBackendBoundaries(root, emptyPolicy));
  for (const rule of ['http-storage', 'http-ownership', 'http-direction']) {
    assert.ok(found.includes(rule), rule);
  }
});

test('checks retired paths, broken modules and production imports of test helpers', (context) => {
  const root = fixture(context, {
    [src + 'store/old.ts']: 'export const old = 1;',
    [src + 'strategy/action.ts']:
      "import './missing.js'; import '../engine/testing/fixture-port.js';",
    [src + 'engine/testing/fixture-port.ts']: 'export const value = 1;',
    [src + 'strategy/action.test-worker.mjs']: "import '../engine/testing/fixture-port.js';",
  });
  const result = checkBackendBoundaries(root, emptyPolicy);
  for (const rule of ['retired-path', 'unresolved-import', 'production-test-dependency']) {
    assert.ok(rules(result).includes(rule), rule);
  }
  assert.equal(
    result.diagnostics.filter((issue) => issue.rule === 'production-test-dependency').length,
    1,
  );
});

test('allows only the index to bootstrap to server startup direction', (context) => {
  const root = fixture(context, {
    [src + 'index.ts']: "import './bootstrap.js';",
    [src + 'bootstrap.ts']: "import './server.js';",
    [src + 'server.ts']: 'export const buildApp = () => {};',
    [src + 'strategy/action.ts']: "import '../bootstrap.js';",
  });
  const issues = checkBackendBoundaries(root, emptyPolicy).diagnostics;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'startup-direction');
  assert.equal(issues[0].from, src + 'strategy/action.ts');
});

test('protects helpers, registries and engine core from host imports', (context) => {
  const root = fixture(context, {
    [src + 'math/helper.ts']: "import 'node:fs';",
    [src + 'market/registry/example.ts']: "import '../sync/example.js';",
    [src + 'market/sync/example.ts']: 'export const value = 1;',
    [src + 'engine/simulation/run.ts']: "import '../adapters/port.js';",
    [src + 'engine/adapters/port.ts']: 'export const value = 1;',
  });
  const found = rules(checkBackendBoundaries(root, emptyPolicy));
  for (const rule of ['pure-helper', 'registry-purity', 'engine-core']) {
    assert.ok(found.includes(rule), rule);
  }
});

test('detects indirect business imports through infrastructure bridges', (context) => {
  const root = fixture(context, {
    [src + 'infra/jobs/run.ts']: "import '../bridge.js';",
    [src + 'market/read.ts']: "import '../infra/bridge.js';",
    [src + 'infra/bridge.ts']: "export { value } from '../strategy/action.js';",
    [src + 'strategy/action.ts']: 'export const value = 1;',
  });
  const found = rules(checkBackendBoundaries(root, emptyPolicy));
  assert.ok(found.includes('infra-transitive-direction'));
  assert.ok(found.includes('market-transitive-direction'));
});

test('requires exact reviewed exceptions and removes them when no longer used', (context) => {
  const from = src + 'engine/factors/custom.ts',
    to = src + 'factor/fields.ts';
  const root = fixture(context, {
    [from]: "import { value } from '../../factor/fields.js';",
    [to]: 'export const value = 1;',
  });
  const policy = {
    edges: [
      {
        rule: 'engine-core',
        from,
        to,
        kind: 'runtime',
        reason: 'Existing pure field definitions.',
      },
    ],
    cycles: [],
  };
  assert.deepEqual(checkBackendBoundaries(root, policy).diagnostics, []);
  fs.writeFileSync(path.join(root, to), "import 'node:fs'; export const value = 1;");
  assert.ok(rules(checkBackendBoundaries(root, policy)).includes('portable-contract'));
  fs.writeFileSync(path.join(root, from), 'export const value = 1;');
  assert.ok(rules(checkBackendBoundaries(root, policy)).includes('stale-exception'));
});

test('finds runtime cross-domain cycles but not erased type-only cycles', (context) => {
  const root = fixture(context, {
    [src + 'research/action.ts']: "import '../factor/action.js';",
    [src + 'factor/action.ts']: "void import('../research/action.js');",
    [src + 'strategy/types.ts']:
      "import type { Input } from '../agent/types.js'; export interface Output {}",
    [src + 'agent/types.ts']:
      "import type { Output } from '../strategy/types.js'; export interface Input {}",
  });
  const dependencies = collectBackendDependencies(root);
  const first = inspectBackendBoundaries(dependencies);
  assert.equal(first.cycles.length, 1);
  assert.equal(first.cycles[0].edges.length, 2);
  const policy = {
    edges: [],
    cycles: [{ reason: 'Fixture baseline only.', edges: first.cycles[0].edges }],
  };
  assert.deepEqual(inspectBackendBoundaries(dependencies, policy).diagnostics, []);
  fs.writeFileSync(
    path.join(root, src + 'factor/action.ts'),
    "import '../research/action.js'; import '../strategy/new.js';",
  );
  fs.writeFileSync(path.join(root, src + 'strategy/new.ts'), "import '../research/action.js';");
  assert.ok(rules(checkBackendBoundaries(root, policy)).includes('cross-domain-cycle'));
  fs.writeFileSync(path.join(root, src + 'factor/action.ts'), 'export const value = 1;');
  assert.ok(rules(checkBackendBoundaries(root, policy)).includes('stale-cycle-exception'));
});

test('reports syntax failures and leaves computed runtime paths to the entry inventory', (context) => {
  const root = fixture(context, {
    [src + 'strategy/invalid.ts']: 'export const = ;',
    [src + 'factor/worker.boot.mjs']: "await import(new URL('./worker.ts', import.meta.url).href);",
  });
  const result = checkBackendBoundaries(root, emptyPolicy);
  assert.ok(rules(result).includes('syntax'));
  assert.equal(result.nonliteralImports.length, 1);
  assert.equal(result.nonliteralImports[0].from, src + 'factor/worker.boot.mjs');
});

test('rejects a new application-wide barrel without prohibiting named business entry files', (context) => {
  const root = fixture(context, {
    [src + 'all.ts']: "export * from './strategy/action.js';",
    [src + 'strategy/action.ts']: 'export const value = 1;',
  });
  assert.ok(rules(checkBackendBoundaries(root, emptyPolicy)).includes('root-barrel'));
});

test('permits module route exports while retaining the HTTP boundary for consumers', (context) => {
  const root = fixture(context, {
    [src + 'server.ts']: "import { strategyDefinitionRoute } from './strategy/routes.js';",
    [src + 'strategy/routes.ts']:
      "export { strategyDefinitionRoute } from './definition-routes.js';",
    [src + 'strategy/definition-routes.ts']:
      "import { Hono } from 'hono'; export const strategyDefinitionRoute = new Hono();",
  });
  assert.deepEqual(checkBackendBoundaries(root, emptyPolicy).diagnostics, []);

  fs.writeFileSync(
    path.join(root, src + 'strategy/operation.ts'),
    "import { strategyDefinitionRoute } from './routes.js';",
  );
  assert.deepEqual(rules(checkBackendBoundaries(root, emptyPolicy)), ['http-direction']);
});

test('treats maintenance middleware as HTTP without widening the business boundary', (context) => {
  const root = fixture(context, {
    [src + 'server.ts']: "import './maintenance/middleware.js';",
    [src + 'maintenance/middleware.ts']:
      "import type { MiddlewareHandler } from 'hono'; import './state.js';",
    [src + 'maintenance/state.ts']: "import { prisma } from '../infra/database/prisma.js';",
    [src + 'infra/database/prisma.ts']: 'export const prisma = {};',
  });
  assert.deepEqual(checkBackendBoundaries(root, emptyPolicy).diagnostics, []);

  fs.writeFileSync(path.join(root, src + 'maintenance/state.ts'), "import './middleware.js';");
  fs.appendFileSync(
    path.join(root, src + 'maintenance/middleware.ts'),
    "import { prisma } from '../infra/database/prisma.js';",
  );
  assert.deepEqual(rules(checkBackendBoundaries(root, emptyPolicy)).sort(), [
    'http-direction',
    'http-storage',
  ]);
});

test('permits shared workspace contracts when resolution points inside the repository', (context) => {
  const root = fixture(
    context,
    {
      [src + 'engine/data/input.ts']: "import { value, type Input } from '@jixie/shared';",
      [src + 'math/input.ts']: "import type { Input } from '@jixie/shared';",
      [src + 'market/registry/input.ts']: "import { value } from '@jixie/shared';",
      'packages/shared/src/index.ts': 'export interface Input {} export const value = 1;',
    },
    { baseUrl: '.', paths: { '@jixie/shared': ['../../packages/shared/src/index.ts'] } },
  );
  const result = checkBackendBoundaries(root, emptyPolicy);
  assert.deepEqual(result.diagnostics, []);
});
