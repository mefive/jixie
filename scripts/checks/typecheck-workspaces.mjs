import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharedDirectory = path.join(root, 'packages/shared');
const sharedPackage = JSON.parse(readFileSync(path.join(sharedDirectory, 'package.json'), 'utf8'));
const sharedPaths = Object.fromEntries(
  Object.entries(sharedPackage.exports).map(([subpath, conditions]) => [
    subpath === '.' ? sharedPackage.name : `${sharedPackage.name}/${subpath.slice(2)}`,
    [path.resolve(sharedDirectory, conditions.types)],
  ]),
);
const declarations = new Map();
const formatting = {
  getCurrentDirectory: () => root,
  getCanonicalFileName: (filename) => filename,
  getNewLine: () => '\n',
};

function readConfig(directory, overrides = {}) {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(directory, 'tsconfig.json'),
    overrides,
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.formatDiagnosticsWithColorAndContext([diagnostic], formatting));
      },
    },
  );
  if (!config || config.errors.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(config?.errors ?? [], formatting));
  }
  return config;
}

function report(directory, diagnostics) {
  if (diagnostics.length > 0) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatting));
    process.exitCode = 1;
    return false;
  }
  console.log(`${path.relative(root, directory)}: typecheck passed`);
  return true;
}

// Build no JavaScript and write no files. Each consumer reads fresh declarations inferred with
// shared's strict settings, even when its own null-checking settings differ or dist is stale.
const sharedConfig = readConfig(sharedDirectory, { noEmit: false, emitDeclarationOnly: true });
const sharedProgram = ts.createProgram({
  rootNames: sharedConfig.fileNames,
  options: sharedConfig.options,
});
const sharedDiagnostics = ts.getPreEmitDiagnostics(sharedProgram);
const declarationResult = sharedProgram.emit(
  undefined,
  (filename, text) => declarations.set(path.resolve(filename), text),
  undefined,
  true,
);
if (report(sharedDirectory, [...sharedDiagnostics, ...declarationResult.diagnostics])) {
  const applications = readdirSync(path.join(root, 'apps')).filter((name) =>
    ts.sys.fileExists(path.join(root, 'apps', name, 'tsconfig.json')),
  );
  for (const name of applications) {
    const directory = path.join(root, 'apps', name);
    const config = readConfig(directory, { noEmit: true });
    config.options.paths = {
      ...config.options.paths,
      ...sharedPaths,
    };
    const host = ts.createCompilerHost(config.options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const directoryExists = host.directoryExists.bind(host);
    const virtualDirectories = new Set();
    for (const filename of declarations.keys()) {
      let parent = path.dirname(filename);
      while (parent.startsWith(sharedDirectory)) {
        virtualDirectories.add(parent);
        parent = path.dirname(parent);
      }
    }
    const canonicalPath = (filename) => {
      const absolute = path.resolve(filename);
      const marker = '/node_modules/@jixie/shared/';
      const markerIndex = absolute.indexOf(marker);
      return markerIndex < 0
        ? absolute
        : path.join(sharedDirectory, absolute.slice(markerIndex + marker.length));
    };
    const isSharedOutput = (filename) =>
      filename === sharedConfig.options.outDir ||
      filename.startsWith(`${sharedConfig.options.outDir}${path.sep}`);
    host.readFile = (filename) => {
      const canonical = canonicalPath(filename);
      return isSharedOutput(canonical) ? declarations.get(canonical) : readFile(filename);
    };
    host.fileExists = (filename) => {
      const canonical = canonicalPath(filename);
      return isSharedOutput(canonical) ? declarations.has(canonical) : fileExists(filename);
    };
    host.directoryExists = (directoryPath) =>
      isSharedOutput(canonicalPath(directoryPath))
        ? virtualDirectories.has(canonicalPath(directoryPath))
        : directoryExists(directoryPath);
    const program = ts.createProgram({
      rootNames: config.fileNames,
      options: config.options,
      host,
    });
    report(directory, ts.getPreEmitDiagnostics(program));
  }
}
