import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

it('removes proof storage while preserving documents, editable source, images and unrelated jobs', async () => {
  const directory = await mkdtemp('/tmp/jixie-research-trim-upgrade-');
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const databaseUrl = `file:${directory}/upgrade.db`;
  const database = new prismaPackage.PrismaClient({ datasourceUrl: databaseUrl });
  const migration = '20261026010000_remove_research_evidence';
  try {
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    for (const name of await readdir(resolve('prisma/migrations'))) {
      if (name < migration || name === 'migration_lock.toml') {
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
      select: { id: true },
    });
    await database.researchDocument.create({
      data: { id: 'document', userId: 'owner', conversationId: 'document' },
      select: { id: true },
    });
    await database.researchCell.create({
      data: {
        id: 'cell',
        documentId: 'document',
        position: 0,
        kind: 'python',
        source: '42',
        definitions: [],
        references: [],
      },
      select: { id: true },
    });
    // 旧字段通过参数化 SQL 构造，只在隔离迁移夹具中使用。
    // Seed removed columns with parameterized SQL only in the isolated migration fixture.
    await database.$executeRaw`INSERT INTO "ResearchExecution" ("id","documentId","sequence","title","contentRevision","runtimeVersion","status","sourceHash","sourceSnapshot","dagSnapshot","executedCellIds") VALUES ('execution','document',1,'Original research',1,'research-py-v1','success','old-hash','{}','{}','[]')`;
    await database.$executeRaw`INSERT INTO "ResearchCellExecution" ("id","documentId","sourceCellId","researchExecutionId","revision","source","status","output","definitions","references","environmentFingerprint") VALUES ('cell-execution','document','cell','execution',1,'42','success','[{"type":"value","value":42}]','[]','[]','old-environment')`;
    const image = Uint8Array.from([1, 2, 3]);
    await database.$executeRaw`INSERT INTO "ResearchArtifact" ("id","documentId","executionId","kind","mimeType","data","byteSize","sha256") VALUES ('image','document','cell-execution','image','image/png',${image},3,'original-image-hash')`;
    await database.job.create({
      data: {
        id: 'job',
        userId: 'owner',
        kind: 'backtest',
        key: 'original',
        status: 'queued',
        payload: { preserved: true },
      },
      select: { id: true },
    });
    await database.factorReport.create({
      data: {
        id: 'published-report',
        userId: 'owner',
        factor: 'original',
        legacyStatus: 'done',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{"retained":true}',
      },
      select: { id: true },
    });
    await database.factor.create({
      data: {
        id: 'factor',
        userId: 'owner',
        key: 'original',
        name: 'Original',
        code: 'saved factor source',
        status: 'published',
        approvedReportId: 'published-report',
        codeHash: 'published-code-hash',
      },
      select: { id: true },
    });
    await database.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Original',
        config: { code: 'saved strategy source', language: 'python' },
      },
      select: { id: true },
    });
    await database.$disconnect();

    await cp(resolve('prisma/migrations', migration), join(migrations, migration), {
      recursive: true,
    });
    deploy();
    expect(await database.researchCell.findUniqueOrThrow({ where: { id: 'cell' } })).toMatchObject({
      source: '42',
    });
    expect(await database.factor.findUniqueOrThrow({ where: { id: 'factor' } })).toMatchObject({
      code: 'saved factor source',
      status: 'published',
      approvedReportId: 'published-report',
      codeHash: 'published-code-hash',
    });
    expect(
      await database.factorReport.findUniqueOrThrow({ where: { id: 'published-report' } }),
    ).toMatchObject({ payload: '{"retained":true}' });
    expect(await database.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).toMatchObject({
      config: { code: 'saved strategy source', language: 'python' },
    });
    await database.researchCellExecution.deleteMany();
    await database.researchExecution.deleteMany();
    expect(
      await database.researchArtifact.findUniqueOrThrow({ where: { id: 'image' } }),
    ).toMatchObject({ documentId: 'document', data: image });
    expect(await database.job.findUniqueOrThrow({ where: { id: 'job' } })).toMatchObject({
      status: 'queued',
      payload: { preserved: true },
    });
    const columns = await database.$queryRaw<
      Array<{ name: string }>
    >`PRAGMA table_info("ResearchExecution")`;
    expect(columns.map((column) => column.name)).not.toContain('sourceSnapshot');
    expect(
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name = 'ResearchExecutionInput'`,
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
