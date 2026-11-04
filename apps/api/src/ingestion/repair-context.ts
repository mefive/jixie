import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { loadMarketDiagnosticContext } from '#market/synchronization/diagnostic-context.js';
import { marketRepairRecord } from '#market/synchronization/repair.js';
import { DIVIDEND_SOURCE_COLUMNS } from '#market/fundamentals/dividend-identity.js';
import type { ActiveIssue } from './issue-state.js';

const payloadRow = z.record(z.string(), z.unknown());

function sourceRows(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [payload];

  return rows.flatMap((row) => {
    const parsed = payloadRow.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** 导出与修复共用 Issue 范围和可定位记录。 / Share issue scope and addressable records between export and repair. */
export async function readRepairContext(database: Prisma.TransactionClient, item: ActiveIssue) {
  const dataset = item.batch?.dataset ?? null;
  const issue = item.issue;
  const fields = issue.field ? [issue.field] : [];
  if (dataset === 'dividends') {
    const rows = sourceRows(issue.payload);
    for (const [field, sourceField] of Object.entries(DIVIDEND_SOURCE_COLUMNS)) {
      if (new Set(rows.map((row) => JSON.stringify(row[sourceField]))).size > 1) {
        fields.push(field);
      }
    }
  }
  if (issue.field === 'ohlc') {
    fields.splice(0, 1, 'open', 'high', 'low', 'close');
  }

  if (dataset !== 'stock-prices' && dataset !== 'dividends') {
    return {
      dataset,
      affectedFields: [...new Set(fields)],
      contextComplete: false,
      identities: [],
      records: [],
      allowedStages: [] as string[],
      limitations: ['market_repair_not_supported_for_dataset'],
    };
  }
  const internal = await loadMarketDiagnosticContext(database, {
    dataset,
    scope: item.batch!.scope,
    period: item.batch!.period,
    startDate: item.batch!.rangeStart,
    endDate: item.batch!.rangeEnd,
    businessKey: issue.businessKey,
    payload: issue.payload,
  });
  const primary = internal.tables.find(
    (table) => table.table === (dataset === 'stock-prices' ? 'Daily' : 'Dividend'),
  );
  const allowedStages =
    dataset === 'dividends'
      ? [
          ...new Set(
            sourceRows(issue.payload).flatMap((row) =>
              typeof row.div_proc === 'string' ? [row.div_proc] : [],
            ),
          ),
        ]
      : [];

  return {
    dataset,
    affectedFields: [...new Set(fields)],
    contextComplete:
      internal.contextComplete && Boolean(primary?.complete) && internal.identities.length > 0,
    identities: internal.identities,
    records: (primary?.rows ?? []).map((row) => marketRepairRecord(dataset, payloadRow.parse(row))),
    allowedStages,
    limitations: internal.limitations,
  };
}

type RepairContext = Awaited<ReturnType<typeof readRepairContext>>;

/** 同一判断用于列出可写目标和拒绝越界修复。 / Use the same rule to advertise and enforce writable targets. */
export function isIssueRepairTarget(
  item: ActiveIssue,
  context: RepairContext,
  dataset: string,
  key: {
    tsCode: string;
    tradeDate?: string;
    endDate?: string;
    divProc?: string;
    annDate?: string;
    exDate?: string | null;
  },
  op: 'insert' | 'update' | 'delete',
): boolean {
  return (
    item.classification === 'current' &&
    item.issue.category === 'record' &&
    context.dataset === dataset &&
    context.contextComplete &&
    context.identities.some(
      (identity) =>
        identity.tsCode === key.tsCode &&
        (key.tradeDate ? identity.tradeDate === key.tradeDate : identity.endDate === key.endDate),
    ) &&
    (dataset !== 'dividends' ||
      Boolean(
        key.divProc &&
        context.allowedStages.includes(key.divProc) &&
        (op === 'insert' ||
          sourceRows(item.issue.payload).some(
            (row) =>
              row.div_proc === key.divProc &&
              row.ann_date === key.annDate &&
              (row.ex_date ?? null) === key.exDate,
          )),
      ))
  );
}

/** 模板只预填可定位的目标，值和证据由维护者核实。 / Prefill addressable targets and leave values and evidence for review. */
export function repairIssueTemplates(item: ActiveIssue, context: RepairContext, finished: boolean) {
  if (!finished) {
    return [];
  }
  const draft = { issueIds: [item.issue.id], reason: '', evidence: [] };
  const storedStatus = item.resolution?.status ?? 'pending';
  if (storedStatus !== 'pending') {
    return [
      {
        ...draft,
        op: 'reopen',
        expectedResolutionVersion: item.resolution!.updatedAt.toISOString(),
      },
    ];
  }

  const templates: Array<Record<string, unknown> & { op: string }> = [{ ...draft, op: 'accept' }];
  const dataset = context.dataset;
  if (dataset !== 'stock-prices' && dataset !== 'dividends') {
    return templates;
  }
  for (const { key, expectedVersion } of context.records) {
    if (key && isIssueRepairTarget(item, context, dataset, key, 'update')) {
      const target = { ...draft, dataset, key, expectedVersion };
      templates.push({ ...target, op: 'update', values: {} }, { ...target, op: 'delete' });
    }
  }
  const insertTargets =
    dataset === 'stock-prices'
      ? context.identities.map(({ tsCode, tradeDate }) => ({ tsCode, tradeDate }))
      : context.identities.flatMap(({ tsCode, endDate }) =>
          context.allowedStages.map((divProc) => ({ tsCode, endDate, divProc })),
        );
  for (const target of insertTargets) {
    if (
      !target.tsCode ||
      !isIssueRepairTarget(item, context, dataset, { ...target, tsCode: target.tsCode }, 'insert')
    ) {
      continue;
    }
    const alreadyPresent =
      dataset === 'stock-prices' &&
      context.records.some(
        ({ key }) =>
          key &&
          'tradeDate' in key &&
          'tradeDate' in target &&
          key.tsCode === target.tsCode &&
          key.tradeDate === target.tradeDate,
      );
    if (!alreadyPresent) {
      templates.push({ ...draft, op: 'insert', dataset, key: target, values: {} });
    }
  }

  return templates;
}
