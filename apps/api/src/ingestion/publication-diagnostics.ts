import pkg, { type Prisma, type IngestionBatch } from '@prisma/client';
import { z } from 'zod';
import type { PublicationPlan } from './publication-plan.js';
import { publicationTableWorkload, recordPublicationWork } from './publication-budget.js';

const inputJson = (value: Prisma.JsonValue) =>
  value === null ? pkg.Prisma.DbNull : (value as Prisma.InputJsonValue);
type Batch = IngestionBatch;
type Issue = Prisma.IngestionIssueGetPayload<{ include: { resolution: true } }>;

/**
 * 将本轮诊断提前分页准备，保留原始 JSON 与日期类型。
 *
 * Prepare this run's diagnostics in pages, preserving JSON and date types.
 */
export async function preparePublicationDiagnostics(
  main: Prisma.TransactionClient,
  candidate: Prisma.TransactionClient,
  runId: string,
  plan: PublicationPlan,
  signal?: AbortSignal,
) {
  const batches = (await publicationTableWorkload(main, 'ingestionBatch')).workload;
  const issues = (await publicationTableWorkload(main, 'ingestionIssue')).workload;
  const resolutions = (await publicationTableWorkload(main, 'ingestionIssueResolution')).workload;
  let after: string | undefined;
  for (;;) {
    signal?.throwIfAborted();
    const rows: Batch[] = await candidate.ingestionBatch.findMany({
      where: { runId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: 250,
    });
    if (!rows.length) {
      break;
    }
    after = rows.at(-1)!.id;
    recordPublicationWork(batches, 'inserted', rows);
    await plan.append({ kind: 'batches', rows });
  }
  after = undefined;
  for (;;) {
    signal?.throwIfAborted();
    const rows: Issue[] = await candidate.ingestionIssue.findMany({
      where: { runId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      include: { resolution: true },
      take: 100,
    });
    if (!rows.length) {
      break;
    }
    after = rows.at(-1)!.id;
    for (const { resolution, ...issue } of rows) {
      recordPublicationWork(issues, 'inserted', [issue]);
      if (resolution) {
        recordPublicationWork(resolutions, 'inserted', [resolution]);
      }
    }
    await plan.append({ kind: 'issues', rows });
  }

  return [batches, issues, resolutions];
}

const diagnosticChunkSchema = z.object({
  kind: z.enum(['batches', 'issues']),
  rows: z.array(z.record(z.string(), z.unknown())),
});

/**
 * 清单摘要保证内容来自本轮准备；这里只转换 Prisma 的 JSON 空值写入语义。
 *
 * Sealed chunks come from this preparation; convert Prisma JSON null write semantics here.
 */
export async function applyPublicationDiagnostics(
  main: Prisma.TransactionClient,
  value: unknown,
  revision: number,
  signal?: AbortSignal,
) {
  const chunk = diagnosticChunkSchema.parse(value);
  if (chunk.kind === 'batches') {
    const rows = chunk.rows as unknown as Batch[];
    await main.ingestionBatch.createMany({
      data: rows.map((row) => ({ ...row, request: row.request as Prisma.InputJsonValue })),
    });
    return;
  }
  for (const { resolution, ...issue } of chunk.rows as unknown as Issue[]) {
    signal?.throwIfAborted();
    await main.ingestionIssue.create({
      data: {
        ...issue,
        payload: inputJson(issue.payload),
        businessKey: inputJson(issue.businessKey),
      },
    });
    if (resolution) {
      await main.ingestionIssueResolution.create({
        data: {
          ...resolution,
          evidence: inputJson(resolution.evidence),
          before: inputJson(resolution.before),
          after: inputJson(resolution.after),
          history: resolution.history as Prisma.InputJsonValue,
          marketRevision: resolution.marketRevision === null ? null : revision,
        },
      });
    }
  }
}
