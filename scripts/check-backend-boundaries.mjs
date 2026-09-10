import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourcePrefix = 'apps/api/src/';
const retiredDirectories = new Set([
  'application',
  'common',
  'utils',
  'lib',
  'routes',
  'services',
  'store',
  'tushare',
  'data-quality',
  'types',
  'fundamentals',
  'rates',
  'macro',
  'commodity',
  'risk',
  'library',
]);
const startupFiles = new Set(['index.ts', 'bootstrap.ts', 'server.ts']);

function sourcePath(file) {
  return file.startsWith(sourcePrefix) ? file.slice(sourcePrefix.length) : null;
}

function isTest(file) {
  return (
    file.startsWith('apps/api/tests/') ||
    /(?:\.(?:test|spec)(?:-worker)?\.[cm]?[jt]sx?$|\/(?:__tests__|testing)\/)/.test(file)
  );
}

function isHttp(file) {
  const local = sourcePath(file);
  return (
    local != null &&
    (/(?:^|\/)(?:[\w-]+-)?routes\.ts$/.test(local) ||
      local.startsWith('auth/http/') ||
      local.startsWith('infra/http/') ||
      local === 'maintenance/http.ts' ||
      /^(?:factor|strategy)\/route-errors\.ts$/.test(local) ||
      startupFiles.has(local))
  );
}

function isPure(file) {
  const local = sourcePath(file);
  return local === 'date.ts' || local?.startsWith('math/') || local?.startsWith('i18n/');
}

function isEngineCore(file) {
  return /^apps\/api\/src\/engine\/(?:simulation\/|data\/|factors\/|types\.ts$)/.test(file);
}

function domain(file) {
  const local = sourcePath(file);
  return local?.includes('/') ? local.split('/')[0] : null;
}

function walk(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
    })
    .sort();
}

/** Read syntax and resolve dependencies without loading or evaluating application modules. */
export function collectBackendDependencies(root) {
  const relative = (file) => path.relative(root, file).split(path.sep).join('/');
  const configPath = path.join(root, 'apps/api/tsconfig.json');
  const options = fs.existsSync(configPath)
    ? ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
          },
        },
      )?.options
    : { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
  if (!options) {
    throw new Error('Cannot load API TypeScript configuration');
  }
  const files = ['apps/api/src', 'apps/api/scripts', 'apps/api/tests'].flatMap((directory) =>
    walk(path.join(root, directory)),
  );
  if (files.length === 0) {
    throw new Error('No API sources found');
  }
  const cache = ts.createModuleResolutionCache(root, (file) => file, options);
  const edges = [];
  const diagnostics = [];
  const nonliteralImports = [];
  for (const absolute of files) {
    const from = relative(absolute);
    const source = ts.createSourceFile(
      absolute,
      fs.readFileSync(absolute, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const diagnostic of source.parseDiagnostics) {
      diagnostics.push({
        rule: 'syntax',
        from,
        line: source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      });
    }
    const add = (specifier, node, kind, form) => {
      const resolved = ts.resolveModuleName(
        specifier,
        absolute,
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      const target = resolved && relative(resolved.resolvedFileName);
      const internal =
        target != null && !target.startsWith('../') && !target.includes('node_modules/');
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const to = internal ? target : specifier;
      edges.push({ from, to, specifier, kind, form, line, internal });
      if (
        (specifier.startsWith('.') || specifier.startsWith('#') || path.isAbsolute(specifier)) &&
        !resolved
      ) {
        diagnostics.push({
          rule: 'unresolved-import',
          from,
          to,
          kind,
          line,
          message: 'Internal module cannot be resolved',
        });
      }
    };
    const literal = (node) =>
      node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        const typeOnly =
          clause?.isTypeOnly ||
          (!clause?.name &&
            named &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every((element) => element.isTypeOnly));
        add(node.moduleSpecifier.text, node, typeOnly ? 'type' : 'runtime', 'import');
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const named = node.exportClause;
        const typeOnly =
          node.isTypeOnly ||
          (named &&
            ts.isNamedExports(named) &&
            named.elements.length > 0 &&
            named.elements.every((element) => element.isTypeOnly));
        add(node.moduleSpecifier.text, node, typeOnly ? 'type' : 'runtime', 're-export');
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        literal(node.argument.literal)
      ) {
        add(node.argument.literal.text, node, 'type', 'import-type');
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        literal(node.moduleReference.expression)
      ) {
        add(
          node.moduleReference.expression.text,
          node,
          node.isTypeOnly ? 'type' : 'runtime',
          'import-equals',
        );
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const form =
          node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require';
        if (literal(node.arguments[0])) {
          add(node.arguments[0].text, node, 'runtime', form);
        } else {
          nonliteralImports.push({
            from,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            form,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { files: files.map(relative), edges, diagnostics, nonliteralImports };
}

function edgeKey(edge) {
  return `${edge.from} -> ${edge.to} (${edge.kind})`;
}

/** Return exact runtime edges participating in strongly connected, cross-domain components. */
export function crossDomainCycles(edges) {
  const graph = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'runtime' || !edge.internal || isTest(edge.from) || isTest(edge.to)) {
      continue;
    }
    if (!graph.has(edge.from)) {
      graph.set(edge.from, []);
    }
    graph.get(edge.from).push(edge);
  }
  let nextIndex = 0;
  const indices = new Map(),
    lowLinks = new Map(),
    active = new Set(),
    stack = [],
    cycles = [];
  const visit = (file) => {
    indices.set(file, nextIndex);
    lowLinks.set(file, nextIndex++);
    active.add(file);
    stack.push(file);
    for (const edge of graph.get(file) ?? []) {
      if (!indices.has(edge.to)) {
        visit(edge.to);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(edge.to)));
      } else if (active.has(edge.to)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(edge.to)));
      }
    }
    if (lowLinks.get(file) !== indices.get(file)) {
      return;
    }
    const members = new Set();
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      members.add(member);
    } while (member !== file);
    if (members.size > 1 && new Set([...members].map(domain).filter(Boolean)).size > 1) {
      const cycleEdges = [...members].flatMap((name) =>
        (graph.get(name) ?? []).filter((edge) => members.has(edge.to)),
      );
      cycles.push({
        files: [...members].sort(),
        edges: [...new Set(cycleEdges.map(edgeKey))].sort(),
      });
    }
  };
  for (const file of graph.keys()) {
    if (!indices.has(file)) {
      visit(file);
    }
  }
  return cycles.sort((left, right) => left.files[0].localeCompare(right.files[0]));
}

/** Rules are intentionally about ownership; ordinary business modules may use Prisma directly. */
export function inspectBackendBoundaries(dependencies, policy = { edges: [], cycles: [] }) {
  const diagnostics = [...dependencies.diagnostics];
  const exceptionsUsed = new Set();
  const portableContracts = new Set(
    (policy.edges ?? []).filter((entry) => entry.rule === 'engine-core').map((entry) => entry.to),
  );
  const exceptionKey = (entry) => `${entry.rule}: ${edgeKey(entry)}`;
  const exceptions = new Map((policy.edges ?? []).map((entry) => [exceptionKey(entry), entry]));
  const report = (rule, edge, message) => {
    const key = exceptionKey({ ...edge, rule });
    if (exceptions.has(key) && exceptions.get(key).reason?.trim()) {
      exceptionsUsed.add(key);
    } else {
      diagnostics.push({ rule, ...edge, message });
    }
  };
  for (const file of dependencies.files) {
    const local = sourcePath(file);
    if (local && (retiredDirectories.has(local.split('/')[0]) || local === 'config.ts')) {
      diagnostics.push({
        rule: 'retired-path',
        from: file,
        message: 'Retired top-level module must not be reintroduced',
      });
    }
  }
  for (const edge of dependencies.edges) {
    if (isTest(edge.from)) {
      continue;
    }
    const local = sourcePath(edge.from),
      target = sourcePath(edge.to);
    const shared = /^@jixie\/shared(?:\/|$)/.test(edge.specifier ?? edge.to);
    const framework = /^(?:hono(?:\/|$)|@hono\/)/.test(edge.to);
    if (local && !local.includes('/') && edge.form === 're-export') {
      report(
        'root-barrel',
        edge,
        'Do not aggregate backend implementation exports at the application root',
      );
    }
    if (framework && !isHttp(edge.from)) {
      report('http-ownership', edge, 'Hono belongs to HTTP and startup adapters');
    }
    if (
      isHttp(edge.from) &&
      (edge.to === '@prisma/client' || target === 'infra/database/prisma.ts')
    ) {
      report(
        'http-storage',
        edge,
        'HTTP adapters must call a business operation instead of Prisma',
      );
    }
    if (!isHttp(edge.from) && isHttp(edge.to) && !startupFiles.has(target)) {
      report('http-direction', edge, 'Business operations cannot import HTTP adapters');
    }
    if (
      portableContracts.has(edge.from) &&
      !shared &&
      (edge.internal
        ? !portableContracts.has(edge.to) && !isPure(edge.to) && !isEngineCore(edge.to)
        : true)
    ) {
      report(
        'portable-contract',
        edge,
        'Engine contract exceptions must remain free of host and business workflow dependencies',
      );
    }
    if (edge.internal && isTest(edge.to)) {
      report(
        'production-test-dependency',
        edge,
        'Production code cannot depend on tests or fixtures',
      );
    }
    if (
      target &&
      startupFiles.has(target) &&
      !(local === 'index.ts' && target === 'bootstrap.ts') &&
      !(local === 'bootstrap.ts' && target === 'server.ts')
    ) {
      report(
        'startup-direction',
        edge,
        'Only index -> bootstrap -> server may import application startup modules',
      );
    }
    if (
      local &&
      /^(?:infra\/(?:runtime|jobs)\/)/.test(local) &&
      target &&
      !target.startsWith('infra/') &&
      !isPure(edge.to)
    ) {
      report('infra-direction', edge, 'Generic runtime/jobs cannot import business modules');
    }
    if (
      isPure(edge.from) &&
      !shared &&
      (edge.internal
        ? !isPure(edge.to)
        : !/^(?:@jixie\/shared(?:\/|$)|dayjs(?:\/|$))/.test(edge.to))
    ) {
      report(
        'pure-helper',
        edge,
        'Math, date and translation helpers cannot import business or host facilities',
      );
    }
    if (
      isEngineCore(edge.from) &&
      !shared &&
      (edge.internal ? !isEngineCore(edge.to) && !isPure(edge.to) : edge.to !== '@jixie/shared')
    ) {
      report(
        'engine-core',
        edge,
        'Engine core cannot depend on host adapters, persistence or application workflows',
      );
    }
    if (
      local?.startsWith('market/') &&
      target &&
      /^(?:strategy|agent|research|signals|maintenance)\//.test(target)
    ) {
      report(
        'market-direction',
        edge,
        'Market supplies data; consumers and aggregate audits must not be imported back',
      );
    }
    if (
      local?.startsWith('market/registry/') &&
      !shared &&
      (edge.internal
        ? !target?.startsWith('market/registry/') && !isPure(edge.to)
        : edge.to !== '@jixie/shared')
    ) {
      report(
        'registry-purity',
        edge,
        'Static registries cannot import persistence, providers or sync operations',
      );
    }
  }
  // A neutral-looking infra file must not provide a back door into business ownership.
  const graph = new Map();
  for (const edge of dependencies.edges.filter((entry) => entry.internal && !isTest(entry.from))) {
    if (!graph.has(edge.from)) {
      graph.set(edge.from, []);
    }
    graph.get(edge.from).push(edge);
  }
  for (const from of dependencies.files.filter((file) => !isTest(file))) {
    const local = sourcePath(from);
    const generic = /^(?:infra\/(?:runtime|jobs)\/)/.test(local ?? '');
    const market = local?.startsWith('market/');
    if (!generic && !market) {
      continue;
    }
    const visited = new Set([from]);
    const pending = [{ file: from, trail: [from] }];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const edge of graph.get(current.file) ?? []) {
        if (visited.has(edge.to)) {
          continue;
        }
        visited.add(edge.to);
        const target = sourcePath(edge.to);
        const forbidden =
          target &&
          (generic
            ? !target.startsWith('infra/') && !isPure(edge.to)
            : /^(?:strategy|agent|research|signals|maintenance)\//.test(target));
        const trail = [...current.trail, edge.to];
        if (forbidden && trail.length > 2) {
          diagnostics.push({
            rule: generic ? 'infra-transitive-direction' : 'market-transitive-direction',
            from,
            to: edge.to,
            kind: edge.kind,
            message: `Indirect ownership violation: ${trail.join(' -> ')}`,
          });
        } else if (!forbidden) {
          pending.push({ file: edge.to, trail });
        }
      }
    }
  }
  for (const [key, entry] of exceptions) {
    if (!exceptionsUsed.has(key)) {
      diagnostics.push({
        rule: 'stale-exception',
        from: entry.from,
        to: entry.to,
        message: `Remove unused or invalid exception: ${key}`,
      });
    }
  }
  const cycles = crossDomainCycles(dependencies.edges);
  const allowedCycleEdges = new Set(
    (policy.cycles ?? []).filter((cycle) => cycle.reason?.trim()).flatMap((cycle) => cycle.edges),
  );
  const currentCycleEdges = new Set(cycles.flatMap((cycle) => cycle.edges));
  for (const cycle of cycles) {
    for (const edge of cycle.edges) {
      if (!allowedCycleEdges.has(edge)) {
        diagnostics.push({
          rule: 'cross-domain-cycle',
          from: cycle.files[0],
          message: `Unreviewed cycle edge: ${edge}`,
        });
      }
    }
  }
  for (const edge of allowedCycleEdges) {
    if (!currentCycleEdges.has(edge)) {
      diagnostics.push({
        rule: 'stale-cycle-exception',
        from: 'backend-boundaries.json',
        message: `Remove resolved cycle edge: ${edge}`,
      });
    }
  }
  return { diagnostics, cycles, exceptionsUsed: exceptionsUsed.size };
}

export function checkBackendBoundaries(root, policy) {
  const dependencies = collectBackendDependencies(root);
  const resolvedPolicy =
    policy ??
    JSON.parse(fs.readFileSync(path.join(root, 'scripts/backend-boundaries.json'), 'utf8'));
  const result = inspectBackendBoundaries(dependencies, resolvedPolicy);
  return {
    ...result,
    files: dependencies.files.length,
    runtimeEdges: dependencies.edges.filter((edge) => edge.kind === 'runtime').length,
    typeEdges: dependencies.edges.filter((edge) => edge.kind === 'type').length,
    nonliteralImports: dependencies.nonliteralImports,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkBackendBoundaries(root);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const issue of result.diagnostics) {
      console.error(
        `${issue.from}${issue.line ? ':' + issue.line : ''} [${issue.rule}] ${issue.message}${issue.to ? ' -> ' + issue.to : ''}`,
      );
    }
    console.log(
      `Backend boundaries: ${result.files} files, ${result.runtimeEdges} runtime edges, ${result.typeEdges} type edges, ${result.diagnostics.length} violations.`,
    );
    console.log(
      `${result.exceptionsUsed} reviewed edge exceptions; ${result.cycles.length} existing cross-domain cycle groups; ${result.nonliteralImports.length} nonliteral imports require the runtime entry inventory.`,
    );
  }
  process.exitCode = result.diagnostics.length > 0 ? 1 : 0;
}
