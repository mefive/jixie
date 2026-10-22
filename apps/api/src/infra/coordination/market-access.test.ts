import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  acquireMarketReader,
  acquireMarketScope,
  isMarketPublicationActive,
  MarketAccessBusyError,
  runOutsideMarketAccess,
  withMaintenanceLock,
  withMarketAccess,
  withMarketPublication,
} from './market-access.js';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

let directory: string;
const children: ChildProcess[] = [];
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-lock-'));
  vi.stubEnv('DATABASE_URL', `file:${resolve(directory, 'formal.db')}`);
  vi.stubEnv('MAINTENANCE_JOB_DRAIN_TIMEOUT_MS', '150');
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((done) => child.once('close', () => done()));
      child.kill('SIGKILL');
      await closed;
    }
  }
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function childHolding(kind: 'reader' | 'maintenance'): Promise<ChildProcess> {
  const child = fork(fileURLToPath(new URL('./market-lock.fixture.ts', import.meta.url)), [kind], {
    execArgv: ['--conditions=development', '--import', 'tsx'],
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  await new Promise<void>((done, reject) => {
    child.once('message', () => done());
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`Lock fixture exited before readiness: ${code}`)),
    );
  });
  return child;
}

async function waitForIntent(): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!(await isMarketPublicationActive())) {
    if (Date.now() > deadline) {
      throw new Error('Publisher did not acquire intent');
    }
    await delay(5);
  }
}

describe('cross-process market coordination', () => {
  it('does not block readers during maintenance preparation', async () => {
    const child = await childHolding('maintenance');
    await expect(withMarketAccess(async () => 'published')).resolves.toBe('published');
    await expect(withMaintenanceLock(async () => {})).rejects.toBeInstanceOf(MarketAccessBusyError);
    child.send('release');
  });

  it('closes admission before draining and releases both publication locks on timeout', async () => {
    await childHolding('reader');
    const publication = withMaintenanceLock(() => withMarketPublication(async () => 'new'));
    const rejected = expect(publication).rejects.toBeInstanceOf(MarketAccessBusyError);
    await waitForIntent();
    await expect(acquireMarketReader()).rejects.toBeInstanceOf(MarketAccessBusyError);
    await rejected;
    expect(await isMarketPublicationActive()).toBe(false);
    await expect(withMarketAccess(async () => 'old')).resolves.toBe('old');
  });

  it('waits for a live reader before publishing', async () => {
    vi.stubEnv('MAINTENANCE_JOB_DRAIN_TIMEOUT_MS', '3000');
    const child = await childHolding('reader');
    let published = false;
    const publication = withMaintenanceLock(() =>
      withMarketPublication(async () => {
        published = true;
      }),
    );
    await waitForIntent();
    expect(published).toBe(false);
    child.send('release');
    await publication;
    expect(published).toBe(true);
  });

  it('retains detached reader references until their own completion', async () => {
    let retained: Awaited<ReturnType<typeof acquireMarketScope>> | undefined;
    await withMarketAccess(async () => {
      retained = await acquireMarketScope();
    });
    await expect(
      withMaintenanceLock(() => withMarketPublication(async () => {})),
    ).rejects.toBeInstanceOf(MarketAccessBusyError);
    await retained!.run(async () => expect(await isMarketPublicationActive()).toBe(false));
    await retained!.release();
    await withMaintenanceLock(() => withMarketPublication(async () => {}));
  });

  it('requires fresh admission for queued work woken inside an existing reader', async () => {
    await withMarketAccess(async () => {
      const publication = runOutsideMarketAccess(() =>
        withMaintenanceLock(() => withMarketPublication(async () => {})),
      );
      const rejected = expect(publication).rejects.toBeInstanceOf(MarketAccessBusyError);
      await waitForIntent();
      await expect(runOutsideMarketAccess(acquireMarketReader)).rejects.toBeInstanceOf(
        MarketAccessBusyError,
      );
      await rejected;
    });
  });

  it('releases ownership after SIGKILL without changing persisted status', async () => {
    const child = await childHolding('maintenance');
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    child.kill('SIGKILL');
    await closed;
    await withMaintenanceLock(async () => {});
  });

  it('canonicalizes directory aliases and rejects a forged inherited descriptor', async () => {
    const child = await childHolding('maintenance');
    await symlink(directory, resolve(directory, 'alias'));
    vi.stubEnv('DATABASE_URL', `file:${resolve(directory, 'alias/formal.db')}`);
    await expect(withMaintenanceLock(async () => {})).rejects.toBeInstanceOf(MarketAccessBusyError);
    child.send('release');
    vi.stubEnv('JIXIE_MAINTENANCE_LOCK_FD', '2');
    await expect(withMaintenanceLock(async () => {})).rejects.toThrow('Invalid inherited');
  });
});

describe('reclaimable owners and inherited maintenance ownership', () => {
  it('keeps shared owners until the last release and reclaims idle files without removing fixed locks', async () => {
    const { acquireMarketLock, cleanupOwnerLocks } = await import('./market-access.js');
    const { readdir, writeFile } = await import('node:fs/promises');
    const first = await acquireMarketLock('owner-SHARED', true);
    const second = await acquireMarketLock('owner-SHARED', true);
    await first.release();
    expect(await cleanupOwnerLocks(true)).toContainEqual({
      file: 'owner-SHARED.lock',
      result: 'active',
    });
    await second.release();
    expect(await readdir(directory)).not.toContain('owner-SHARED.lock');
    await writeFile(resolve(directory, 'owner-STALE.lock'), '');
    await writeFile(resolve(directory, 'maintenance.lock'), '');
    await symlink(resolve(directory, 'maintenance.lock'), resolve(directory, 'owner-ALIAS.lock'));
    const result = await cleanupOwnerLocks(true);
    expect(result).toContainEqual({ file: 'owner-STALE.lock', result: 'removed' });
    expect(result).toContainEqual({ file: 'owner-ALIAS.lock', result: 'unknown-file' });
    expect(await readdir(directory)).toContain('maintenance.lock');
  });

  it('reopens an owner whose pathname was replaced after opening', async () => {
    const filesystem = await import('node:fs/promises');
    const { acquireMarketLock } = await import('./market-access.js');
    const original = filesystem.open;
    const filename = resolve(await filesystem.realpath(directory), 'owner-RACE.lock');
    let replaced = false;
    const opened = vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (args[0] === filename && !replaced) {
        replaced = true;
        await filesystem.unlink(filename);
        await filesystem.writeFile(filename, 'replacement');
      }
      return handle;
    });
    try {
      const owner = await acquireMarketLock('owner-RACE');
      expect(opened.mock.calls.filter(([path]) => path === filename)).toHaveLength(2);
      await owner.release();
      await expect(filesystem.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      opened.mockRestore();
    }
  });

  it('keeps M while an inherited writer survives SIGKILL of its parent', async () => {
    const parent = fork(
      fileURLToPath(new URL('./market-inherited-lock.fixture.ts', import.meta.url)),
      [],
      {
        execArgv: ['--conditions=development', '--import', 'tsx'],
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    children.push(parent);
    const descendant = await new Promise<number>((done, reject) => {
      parent.once('message', (message) => done((message as { pid: number }).pid));
      parent.once('error', reject);
      parent.once('exit', () =>
        reject(new Error('Parent exited before inherited writer was ready')),
      );
    });
    try {
      const closed = new Promise<void>((done) => parent.once('close', () => done()));
      parent.kill('SIGKILL');
      await closed;
      await expect(withMaintenanceLock(async () => {})).rejects.toBeInstanceOf(
        MarketAccessBusyError,
      );
    } finally {
      process.kill(descendant, 'SIGKILL');
    }
    const { acquireMarketLock } = await import('./market-access.js');
    const released = await acquireMarketLock('maintenance', false, 3000);
    await released.release();
  }, 10_000);
});
