import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { createReadCopy, cleanReadCopies } from './read-copy.js';

describe('owned market calculation resources', () => {
  it('R07/A11/A13 releases normal copies while retaining active and unknown resources', async () =>
    withSyncDatabase(async (_database, directory) => {
      const source = join(directory, 'test.db');
      const copy = await createReadCopy(source, [{ name: 'Daily' }]);
      const unknown = join(dirname(dirname(copy.filename)), 'unknown');
      await mkdir(unknown);
      await writeFile(join(unknown, 'keep.txt'), 'user-owned fixture');
      expect(await cleanReadCopies(source)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('active calculation resource'),
          expect.stringContaining('unknown calculation resource'),
        ]),
      );
      expect(await readFile(join(unknown, 'keep.txt'), 'utf8')).toBe('user-owned fixture');
      await copy.close();
      await expect(access(dirname(copy.filename))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await cleanReadCopies(source)).toEqual([
        expect.stringContaining('unknown calculation resource'),
      ]);
    }));

  it(
    'R07/A11 reclaims a proven copy after its process is killed without restarting the database host',
    async () =>
      withSyncDatabase(async (database, directory) => {
        const source = join(directory, 'test.db');
        await database.daily.create({
          data: { tsCode: '600000.SH', tradeDate: '20260915', close: 10 },
        });
        const modulePath = fileURLToPath(new URL('./read-copy.ts', import.meta.url));
        const script = `
      import { createReadCopy } from ${JSON.stringify(modulePath)};
      const copy = await createReadCopy(process.argv[1], [{ name: 'Daily' }]);
      process.send({ filename: copy.filename });
      setInterval(() => {}, 1000);
    `;
        const child = spawn(
          process.execPath,
          [
            '--conditions=development',
            '--import',
            'tsx',
            '--input-type=module',
            '--eval',
            script,
            source,
          ],
          { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env } },
        );
        let diagnostics = '';
        child.stderr?.on('data', (chunk) => {
          diagnostics += String(chunk);
        });
        try {
          const [message] = await Promise.race([
            once(child, 'message', { signal: AbortSignal.timeout(10_000) }),
            once(child, 'exit').then(() => {
              throw new Error(`Copy owner exited before readiness: ${diagnostics}`);
            }),
          ]);
          const filename = (message as { filename: string }).filename;
          expect(await cleanReadCopies(source)).toEqual([
            expect.stringContaining('active calculation resource'),
          ]);
          const exited = once(child, 'exit');
          child.kill('SIGKILL');
          await exited;
          expect(await cleanReadCopies(source)).toEqual([]);
          await expect(access(dirname(filename))).rejects.toMatchObject({ code: 'ENOENT' });
          expect(await database.daily.count()).toBe(1);
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGKILL');
            await exited;
          }
        }
      }),
    30_000,
  );
});
