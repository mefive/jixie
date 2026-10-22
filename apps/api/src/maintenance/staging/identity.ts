import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '#infra/database/prisma.js';
import { databaseFilename } from '#infra/coordination/market-access.js';
import type { StagingRequirements } from '#infra/coordination/staging-input.js';

export async function requirements(): Promise<StagingRequirements> {
  return getDatabase().$transaction(async (transaction) => {
    const active = await transaction.strategyDeployment.findMany({
      where: { status: 'active' },
      orderBy: { id: 'asc' },
      select: { config: true, factorDependencies: true },
    });
    const versioned = await transaction.strategyDeployment.findMany({
      where: { accountingVersion: 2 },
      orderBy: { id: 'asc' },
      select: { config: true, status: true, accountStates: { take: 1, select: { id: true } } },
    });

    return {
      active,
      versioned: versioned.map((entry) => ({
        config: entry.config,
        status: entry.status,
        hasAccounts: entry.accountStates.length > 0,
      })),
    };
  });
}

export function fingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** 代码变化使旧断点失效，开发环境也不依赖 Git HEAD。 / Invalidate checkpoints on code changes, including uncommitted development edits. */
export async function rulesFingerprint(): Promise<string> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const digest = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filename);
      } else if (/\.(ts|js|mjs|py|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        digest.update(filename.slice(root.length)).update(await readFile(filename));
      }
    }
  };
  await visit(root);
  await visit(fileURLToPath(new URL('../../../scripts/', import.meta.url)));
  const sharedDirectory = fileURLToPath(
    new URL(
      import.meta.url.includes('/dist/')
        ? '../../../../../../packages/shared/'
        : '../../../../../packages/shared/',
      import.meta.url,
    ),
  );
  await visit(sharedDirectory + (import.meta.url.endsWith('.ts') ? 'src' : 'dist'));
  digest.update(process.versions.node).update(process.env.JIXIE_APP_REVISION ?? 'development');

  return digest.digest('hex');
}

export function stagingDirectory(id: string): string {
  if (!/^[A-Z0-9]+$/.test(id)) {
    throw new Error('Invalid staging identity');
  }

  return resolve(dirname(databaseFilename()), 'maintenance-staging', id);
}
