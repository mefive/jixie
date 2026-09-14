import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

it('preserves existing Agent conversations and turns when adding private question context', async () => {
  const migration = '20260914110000_factor_question_conversations';
  const directory = await mkdtemp('/tmp/jixie-factor-question-upgrade-');
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const databaseUrl = `file:${directory}/upgrade.db`;
  const database = new prismaPackage.PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    for (const name of await readdir(resolve('prisma/migrations'))) {
      if (name !== migration) {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    const deploy = () =>
      execFileSync(
        process.execPath,
        [
          createRequire(import.meta.url).resolve('prisma/build/index.js'),
          'migrate',
          'deploy',
          '--schema',
          schema,
        ],
        { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
      );
    deploy();
    await database.user.create({ data: { id: 'owner', email: 'upgrade@fixture.invalid' } });
    await database.agentConversation.createMany({
      data: [
        { id: 'old-a', userId: 'owner', surface: 'research' },
        { id: 'old-b', userId: 'owner', surface: 'research' },
      ],
    });
    const trace = { version: 1, steps: [], truncated: false };
    await database.agentTurn.create({
      data: { id: 'old-turn', conversationId: 'old-a', model: 'original', status: 'done', trace },
      select: { id: true },
    });
    await database.agentMessage.create({
      data: {
        id: 'old-message',
        conversationId: 'old-a',
        turnId: 'old-turn',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Original answer' }],
        sequence: 0,
      },
    });
    await database.$disconnect();
    await cp(resolve('prisma/migrations', migration), join(migrations, migration), {
      recursive: true,
    });
    deploy();
    expect(await database.agentConversation.count({ where: { questionFactorKey: null } })).toBe(2);
    expect(await database.agentTurn.findUniqueOrThrow({ where: { id: 'old-turn' } })).toMatchObject(
      { model: 'original', status: 'done', trace, contextSnapshot: null },
    );
    expect(
      await database.agentMessage.findUniqueOrThrow({ where: { id: 'old-message' } }),
    ).toMatchObject({ parts: [{ type: 'text', text: 'Original answer' }], turnId: 'old-turn' });
    await database.agentConversation.create({
      data: {
        id: 'question-a',
        userId: 'owner',
        surface: 'factor-question',
        questionFactorKey: 'ep',
      },
    });
    await expect(
      database.agentConversation.create({
        data: {
          id: 'question-b',
          userId: 'owner',
          surface: 'factor-question',
          questionFactorKey: 'ep',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
