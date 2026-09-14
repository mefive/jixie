import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

const migration = '20260914090000_embedded_analysis_execution';

it('upgrades existing Job and Research evidence without rewriting or deleting their payloads', async () => {
  const directory = await mkdtemp('/tmp/jixie-embedded-upgrade-');
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
    await database.agentConversation.create({
      data: { id: 'document', userId: 'owner', surface: 'research', title: 'Original research' },
    });
    await database.researchDocument.create({
      data: { id: 'document', userId: 'owner', conversationId: 'document' },
    });
    const sourceSnapshot = {
      version: 1,
      cells: [
        {
          id: 'cell',
          position: 0,
          kind: 'python',
          source: '42',
          revision: 1,
          definitions: [],
          references: [],
        },
      ],
    };
    await database.researchExecution.create({
      data: {
        id: 'execution',
        documentId: 'document',
        sequence: 1,
        title: 'Original research',
        contentRevision: 1,
        runtimeVersion: 'research-py-v1',
        status: 'success',
        sourceHash: 'original-source-hash',
        sourceSnapshot,
        dagSnapshot: { version: 1, nodes: [] },
        executedCellIds: ['cell'],
        environmentFingerprint: 'original-environment',
        promotedAt: new Date('2026-01-01T00:00:00Z'),
      },
      select: { id: true },
    });
    await database.researchCellExecution.create({
      data: {
        id: 'cell-execution',
        documentId: 'document',
        sourceCellId: 'cell',
        researchExecutionId: 'execution',
        revision: 1,
        source: '42',
        status: 'success',
        output: [{ type: 'value', value: 42 }],
        definitions: [],
        references: [],
        environmentFingerprint: 'original-environment',
      },
    });
    await database.researchArtifact.create({
      data: {
        id: 'image',
        documentId: 'document',
        executionId: 'cell-execution',
        kind: 'image',
        mimeType: 'image/png',
        data: Uint8Array.from([1, 2, 3]),
        byteSize: 3,
        sha256: 'original-image-hash',
      },
    });
    await database.job.create({
      data: {
        id: 'job',
        userId: 'owner',
        kind: 'backtest',
        key: 'original',
        status: 'queued',
        payload: { preserved: true },
        logs: '[]',
      },
      select: { id: true },
    });
    await database.$disconnect();
    await cp(resolve('prisma/migrations', migration), join(migrations, migration), {
      recursive: true,
    });
    deploy();
    const execution = await database.researchExecution.findUniqueOrThrow({
      where: { id: 'execution' },
      include: { cellExecutions: true },
    });
    expect(execution).toMatchObject({
      sourceHash: 'original-source-hash',
      sourceSnapshot,
      status: 'success',
      embeddedVersionId: null,
      parametersSnapshot: null,
      promotedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(execution.cellExecutions[0].output).toEqual([{ type: 'value', value: 42 }]);
    expect(
      (await database.researchArtifact.findUniqueOrThrow({ where: { id: 'image' } })).data,
    ).toEqual(Uint8Array.from([1, 2, 3]));
    expect(await database.job.findUniqueOrThrow({ where: { id: 'job' } })).toMatchObject({
      status: 'queued',
      payload: { preserved: true },
      researchExecutionId: null,
    });
    expect(await database.researchEmbeddedAnalysis.count()).toBe(0);
    expect(await database.researchExecutionInput.count()).toBe(0);
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
