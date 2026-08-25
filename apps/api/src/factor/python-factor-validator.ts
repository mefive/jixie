import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { renderFactorPythonSdkStub } from '@jixie/shared';
import type { EditableFactorAnalysisKind } from './validate-factor-definition.js';

const FACTOR_FACTORY_PATTERN =
  /(?:^|\n)\s*factor\s*=\s*Factor\.(cross_sectional|time_series|panel)\s*\(/;
const FACTOR_COMPUTE_PATTERN = /(?:^|\n)\s*@factor\.compute\s*(?:\n|$)/;
const FACTOR_IMPORT_PATTERN = /(?:^|\n)\s*from\s+jixie\s+import\s+[^\n]*\bFactor\b[^\n]*(?:\n|$)/;
const TARGET_ASSET_CLASSES_PATTERN = /\btarget_asset_classes\s*=\s*\[([^\]]*)\]/m;
const MAX_DIAGNOSTICS = 4;
type PythonAssetClass = 'equity' | 'fixed_income' | 'commodity';

interface PyrightOutput {
  generalDiagnostics?: Array<{
    severity?: string;
    message?: string;
    range?: { start?: { line?: number; character?: number } };
  }>;
}

/** Validate a Python Factor without executing user code. Runtime metadata is validated separately. */
export async function validatePythonFactorDefinition(
  source: string,
  analysisKind: EditableFactorAnalysisKind,
): Promise<void> {
  if (!FACTOR_IMPORT_PATTERN.test(source)) {
    throw new Error('Python Factor code must import `Factor` with `from jixie import Factor`.');
  }
  const factory = source.match(FACTOR_FACTORY_PATTERN)?.[1];
  if (!factory) {
    throw new Error('Python Factor code must assign `factor = Factor.<analysis_kind>(...)`.');
  }
  if (factory !== analysisKind) {
    throw new Error(`Python Factor factory ${factory} does not match ${analysisKind}.`);
  }
  if (analysisKind === 'time_series' || analysisKind === 'panel') {
    pythonFactorTargetAssetClasses(source);
  }
  if (!FACTOR_COMPUTE_PATTERN.test(source)) {
    throw new Error('Python Factor code must decorate one function with `@factor.compute`.');
  }

  const workspacePath = await mkdtemp(join(tmpdir(), 'jixie-factor-pyright-'));
  try {
    const typingsPath = join(workspacePath, 'typings');
    await mkdir(typingsPath, { recursive: true });
    await Promise.all([
      writeFile(join(workspacePath, 'factor.py'), source, 'utf8'),
      writeFile(join(typingsPath, 'jixie.pyi'), renderFactorPythonSdkStub(), 'utf8'),
      writeFile(
        join(workspacePath, 'pyrightconfig.json'),
        `${JSON.stringify(
          {
            typeCheckingMode: 'basic',
            pythonVersion: '3.13',
            stubPath: 'typings',
            include: ['factor.py'],
            useLibraryCodeForTypes: false,
          },
          null,
          2,
        )}\n`,
        'utf8',
      ),
    ]);
    const output = await runPyright(workspacePath);
    const diagnostics = (output.generalDiagnostics ?? []).filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    if (diagnostics.length > 0) {
      const message = diagnostics
        .slice(0, MAX_DIAGNOSTICS)
        .map((diagnostic) => {
          const line = (diagnostic.range?.start?.line ?? 0) + 1;
          const character = (diagnostic.range?.start?.character ?? 0) + 1;
          return `${line}:${character} ${diagnostic.message ?? 'Invalid Python Factor code'}`;
        })
        .join('\n');
      throw new Error(message);
    }
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

/** Read the literal asset-domain declaration without starting the Python execution sandbox. */
export function pythonFactorTargetAssetClasses(source: string): PythonAssetClass[] {
  const declaration = source.match(TARGET_ASSET_CLASSES_PATTERN)?.[1];
  if (declaration === undefined) {
    throw new Error('Python asset Factor requires a literal target_asset_classes list.');
  }
  const quotedClassPattern = /(['"])(equity|fixed_income|commodity)\1/g;
  const values = [...declaration.matchAll(quotedClassPattern)].map(
    (match) => match[2] as PythonAssetClass,
  );
  const remainder = declaration.replace(quotedClassPattern, '').replace(/[\s,]/g, '');
  if (values.length === 0 || remainder || new Set(values).size !== values.length) {
    throw new Error(
      'Python target_asset_classes must be a non-empty literal list of unique supported classes.',
    );
  }
  return values;
}

function runPyright(workspacePath: string): Promise<PyrightOutput> {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('pyright/package.json');
  const cliPath = join(dirname(packagePath), 'index.js');
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(
      process.execPath,
      [cliPath, '--outputjson', '--project', 'pyrightconfig.json'],
      {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectOutput);
    child.once('exit', () => {
      try {
        resolveOutput(JSON.parse(stdout) as PyrightOutput);
      } catch {
        rejectOutput(new Error(stderr.trim() || stdout.trim() || 'Pyright validation failed.'));
      }
    });
  });
}
