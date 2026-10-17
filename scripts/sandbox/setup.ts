import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderResearchSdkPythonStub } from '../../packages/shared/src/sdk/research/python-stub.js';
import { renderFactorPythonSdkStub } from '../../packages/shared/src/sdk/factor/python.js';
import { renderResearchPythonRuntimeRequirements } from '../../packages/shared/src/research-python-runtime.js';
import { renderStrategySdkContract } from '../../packages/shared/src/sdk/strategy/reference.js';
import { renderFactorSdkContract } from '../../packages/shared/src/sdk/factor/reference.js';
import { ensurePythonEnvironment } from './python-environment.js';

export const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));

export function sandboxArtifacts() {
  return [
    { path: 'apps/sandboxd/python/jixie_research_sdk.pyi', content: renderResearchSdkPythonStub() },
    { path: 'apps/sandboxd/python/jixie_factor_sdk.pyi', content: renderFactorPythonSdkStub() },
    { path: 'packages/shared/src/sdk/factor/contract.ts', content: renderFactorSdkContract() },
    {
      path: 'packages/shared/src/sdk/strategy/contract.ts',
      content: renderStrategySdkContract(),
    },
    {
      path: 'apps/sandboxd/python/requirements-research-runtime.txt',
      content: renderResearchPythonRuntimeRequirements(),
    },
  ];
}

/**
 * 解析 setup、check 与 help 模式，拒绝未知参数。
 * Parse setup, check and help modes and reject unsupported arguments.
 */
export function parseSetupMode(args: string[]): 'setup' | 'check' | 'help' {
  if (args.length === 0) {
    return 'setup';
  }
  if (args.length === 1) {
    switch (args[0]) {
      case '--check':
        return 'check';
      case '--help':
      case '-h':
        return 'help';
    }
  }
  throw new Error('Usage: pnpm setup:sandbox [--check | --help]');
}

/**
 * 比较或写入公开契约生成物，check 模式只读并报告过期文件。
 * Compare or synchronize generated artifacts; check mode is read-only and reports stale files.
 */
export async function synchronizeArtifacts(directory: string, check: boolean): Promise<string[]> {
  const stale: string[] = [];
  for (const artifact of sandboxArtifacts()) {
    const path = resolve(directory, artifact.path);
    const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return null;
    });
    if (current === artifact.content) {
      continue;
    }
    stale.push(artifact.path);
    if (!check) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifact.content);
    }
  }
  if (check && stale.length) {
    throw new Error(`Stale sandbox artifacts:\n${stale.join('\n')}\nRun pnpm setup:sandbox.`);
  }
  return stale;
}

/**
 * 按模式协调生成物同步和 Python 环境准备，check 模式不安装或启动服务。
 * Coordinate artifact synchronization and Python preparation without installation or services in check mode.
 */
export async function setupSandbox(
  args: string[],
  directory = projectDirectory,
  prepareEnvironment = ensurePythonEnvironment,
): Promise<void> {
  const mode = parseSetupMode(args);
  if (mode === 'help') {
    console.log(
      'Usage: pnpm setup:sandbox [--check | --help]\n' +
        'Default: update SDK declarations and requirements, then prepare the local Python environment.\n' +
        '--check: verify generated files only; no Python, installation, file writes or service startup.',
    );
    return;
  }

  const changed = await synchronizeArtifacts(directory, mode === 'check');
  console.log(
    changed.length
      ? `[setup:sandbox] updated ${changed.join(', ')}`
      : '[setup:sandbox] generated files are current',
  );
  if (mode === 'setup') {
    await prepareEnvironment(directory);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void setupSandbox(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`[setup:sandbox] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
