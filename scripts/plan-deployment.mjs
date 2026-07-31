#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = resolve(scriptDirectory, '../deploy/component-impact.json');

export function classifyChangedPaths(changedPaths, manifest) {
  const selectedComponents = new Set();
  const reasons = new Set();
  let fullDeploy = false;
  let installDependencies = false;

  for (const changedPath of changedPaths) {
    if (
      changedPath === 'package.json' ||
      changedPath === 'pnpm-lock.yaml' ||
      changedPath === 'pnpm-workspace.yaml' ||
      changedPath.endsWith('/package.json')
    ) {
      installDependencies = true;
    }

    if (
      manifest.noRuntimeFiles.includes(changedPath) ||
      manifest.noRuntimePrefixes.some((prefix) => changedPath.startsWith(prefix))
    ) {
      continue;
    }

    const component = Object.entries(manifest.components).find(([, prefixes]) =>
      prefixes.some((prefix) => changedPath.startsWith(prefix)),
    )?.[0];
    if (component) {
      selectedComponents.add(component);
      reasons.add(component);
      continue;
    }

    if (
      manifest.sharedPrefixes.some((prefix) => changedPath.startsWith(prefix)) ||
      manifest.fullDeployFiles.includes(changedPath) ||
      manifest.fullDeployPrefixes.some((prefix) => changedPath.startsWith(prefix))
    ) {
      fullDeploy = true;
      reasons.add(changedPath);
      continue;
    }

    fullDeploy = true;
    reasons.add(`unknown:${changedPath}`);
  }

  if (fullDeploy) {
    for (const component of manifest.allComponents) {
      selectedComponents.add(component);
    }
  }

  return {
    api: selectedComponents.has('api'),
    web: selectedComponents.has('web'),
    docs: selectedComponents.has('docs'),
    fullDeploy,
    installDependencies,
    reasons: [...reasons],
  };
}

function runGit(repositoryDirectory, arguments_) {
  return spawnSync('git', ['-C', repositoryDirectory, ...arguments_], {
    encoding: 'utf8',
  });
}

function fullPlan(manifest, reason) {
  return {
    api: true,
    web: true,
    docs: true,
    fullDeploy: true,
    installDependencies: true,
    changedCount: 0,
    reasons: [reason],
    allComponents: manifest.allComponents,
  };
}

async function planDeployment({ repositoryDirectory, baseRevision, headRevision, manifestPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!baseRevision) {
    return fullPlan(manifest, 'no-successful-deployment-marker');
  }

  const baseCheck = runGit(repositoryDirectory, ['cat-file', '-e', `${baseRevision}^{commit}`]);
  if (baseCheck.status !== 0) {
    return fullPlan(manifest, 'deployment-marker-is-not-a-local-commit');
  }

  const ancestorCheck = runGit(repositoryDirectory, [
    'merge-base',
    '--is-ancestor',
    baseRevision,
    headRevision,
  ]);
  if (ancestorCheck.status !== 0) {
    return fullPlan(manifest, 'deployment-marker-is-not-an-ancestor');
  }

  const diff = runGit(repositoryDirectory, [
    'diff',
    '--name-only',
    '-z',
    `${baseRevision}..${headRevision}`,
  ]);
  if (diff.status !== 0) {
    return fullPlan(manifest, 'git-diff-failed');
  }

  const changedPaths = diff.stdout.split('\0').filter(Boolean);
  return {
    ...classifyChangedPaths(changedPaths, manifest),
    changedCount: changedPaths.length,
    allComponents: manifest.allComponents,
  };
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Expected --repository, --base, and --head argument pairs');
    }
    values.set(key.slice(2), value);
  }

  return {
    repositoryDirectory: values.get('repository') ?? process.cwd(),
    baseRevision: values.get('base') ?? '',
    headRevision: values.get('head') ?? 'HEAD',
    manifestPath: values.get('manifest') ?? defaultManifestPath,
  };
}

async function main() {
  const plan = await planDeployment(parseArguments(process.argv.slice(2)));
  const reasonText = plan.reasons.length > 0 ? plan.reasons.join(',') : 'no-runtime-changes';
  process.stderr.write(
    `Deployment impact: api=${Number(plan.api)} web=${Number(plan.web)} docs=${Number(plan.docs)} ` +
      `full=${Number(plan.fullDeploy)} install=${Number(plan.installDependencies)} ` +
      `changed=${plan.changedCount} reason=${reasonText}\n`,
  );
  process.stdout.write(
    `${Number(plan.api)} ${Number(plan.web)} ${Number(plan.docs)} ${Number(plan.fullDeploy)} ` +
      `${Number(plan.installDependencies)}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
