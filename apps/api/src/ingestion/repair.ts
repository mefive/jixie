import type { Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import {
  databaseFilename,
  withMaintenanceLock,
  withMarketPublication,
} from '#infra/coordination/market-access.js';
import { fingerprint } from '#market/synchronization/rows.js';
import { prepareMarketRepair } from '#market/synchronization/repair.js';
import { readRunIssueState, type ActiveIssue } from './issue-state.js';
import { recordIssueResolution } from './resolutions.js';
import { isIssueRepairTarget, readRepairContext } from './repair-context.js';
import { repairReceiptSchema, type IssueRepairPlan } from './repair-schema.js';
import { IngestionError } from './errors.js';
import type { ResolutionRows } from './resolution-schema.js';

type Action = IssueRepairPlan['actions'][number];
type Mutation = Awaited<ReturnType<typeof prepareMarketRepair>>;

interface RepairOptions {
  expectedHash?: string;
  backup: () => Promise<string>;
  signal?: AbortSignal;
}

function receiptOf(issue: ActiveIssue) {
  const evidence = issue.resolution?.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return null;
  }
  const parsed = repairReceiptSchema.safeParse(evidence.receipt);

  return parsed.success ? parsed.data : null;
}

async function prepare(
  database: Prisma.TransactionClient,
  plan: IssueRepairPlan,
  expectedHash?: string,
) {
  const { run, active } = await readRunIssueState(database, plan.runId);
  if (!run.finishedAt || run.status === 'running') {
    throw new IngestionError('resolution_not_ready');
  }
  const byId = new Map(active.map((item) => [item.issue.id, item]));
  const issueIds = [...new Set(plan.actions.flatMap((action) => action.issueIds))];
  const issues = issueIds.map((id) => {
    const issue = byId.get(id);
    if (!issue) {
      throw new IngestionError('export_issue_not_current');
    }

    return issue;
  });
  const revision = await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } });
  const requestHash = fingerprint({ database: databaseFilename(), plan });
  if (
    expectedHash &&
    issues.every((issue) => {
      const receipt = receiptOf(issue);
      return receipt?.planHash === expectedHash && receipt.requestHash === requestHash;
    })
  ) {
    return {
      mode: 'already_applied' as const,
      planHash: expectedHash,
      issueIds,
      marketRevision: revision.revision,
    };
  }

  const prepared = [];
  const targets = new Set<string>();
  const issueActions = new Map<
    string,
    { issue: ActiveIssue; actions: Action[]; mutations: Mutation[] }
  >();
  for (const action of plan.actions) {
    if (new Set(action.issueIds).size !== action.issueIds.length) {
      throw new IngestionError('repair_scope_mismatch');
    }
    let mutation: Mutation | null = null;
    if ('dataset' in action) {
      const target = fingerprint({ dataset: action.dataset, key: action.key });
      if (targets.has(target)) {
        throw new IngestionError('repair_scope_mismatch');
      }
      targets.add(target);
      mutation = await prepareMarketRepair(database, action);
      if (fingerprint({ values: mutation.before }) === fingerprint({ values: mutation.after })) {
        throw new IngestionError('repair_no_change');
      }
    }

    for (const issueId of action.issueIds) {
      const issue = byId.get(issueId)!;
      const status = issue.resolution?.status ?? 'pending';
      if (action.op === 'reopen') {
        if (
          !['accepted', 'resolved'].includes(status) ||
          action.expectedResolutionVersion !== issue.resolution?.updatedAt.toISOString()
        ) {
          throw new IngestionError('resolution_already_handled');
        }
      } else if (status !== 'pending') {
        throw new IngestionError('resolution_already_handled');
      }
      const group = issueActions.get(issueId) ?? { issue, actions: [], mutations: [] };
      if (group.actions.length && (!mutation || !group.mutations.length)) {
        throw new IngestionError('repair_scope_mismatch');
      }
      if ('dataset' in action && mutation) {
        const context = await readRepairContext(database, issue);
        if (!isIssueRepairTarget(issue, context, action.dataset, action.key, action.op)) {
          throw new IngestionError('repair_scope_mismatch');
        }
        group.mutations.push(mutation);
      }
      group.actions.push(action);
      issueActions.set(issueId, group);
    }
    prepared.push({ action, mutation });
  }

  for (const { actions } of issueActions.values()) {
    if (
      actions.map((action) => action.reason).join('\n').length > 4000 ||
      new Set(actions.flatMap((action) => action.evidence)).size > 100
    ) {
      throw new IngestionError('repair_scope_mismatch');
    }
  }

  const changes = prepared.flatMap(({ action, mutation }) =>
    mutation
      ? [
          {
            op: action.op,
            issueIds: action.issueIds,
            dataset: mutation.dataset,
            key: mutation.key,
            before: mutation.before,
            after: mutation.after,
          },
        ]
      : [],
  );
  const handling = [...issueActions].map(([issueId, { issue, actions }]) => ({
    issueId,
    before: issue.resolution?.status ?? 'pending',
    after:
      actions[0].op === 'accept' ? 'accepted' : actions[0].op === 'reopen' ? 'pending' : 'resolved',
  }));
  const planHash = fingerprint({
    requestHash,
    revision: revision.revision,
    changes,
    handling,
    issues: issues.map(({ issue, resolution, classification }) => ({
      issueId: issue.id,
      batchId: issue.batchId,
      classification,
      updatedAt: resolution?.updatedAt ?? null,
    })),
  });

  return {
    mode: 'preview' as const,
    planHash,
    requestHash,
    revision: revision.revision,
    prepared,
    issueActions,
    changes,
    handling,
  };
}

function previewResult(
  prepared: Extract<Awaited<ReturnType<typeof prepare>>, { mode: 'preview' }>,
) {
  return {
    mode: prepared.mode,
    planHash: prepared.planHash,
    marketRevision: prepared.revision,
    changedRecords: prepared.changes.length,
    changes: prepared.changes,
    handling: prepared.handling,
  };
}

/** 预览只读，执行重新核验并原子写入数据、版本和处理结果。 / Preview reads only; apply rechecks and commits data, revision and handling atomically. */
export async function repairIngestionIssues(plan: IssueRepairPlan, options: RepairOptions) {
  const database = getDatabase();
  const expectedHash = options.expectedHash;
  if (!expectedHash) {
    const result = await database.$transaction((transaction) => prepare(transaction, plan));

    return result.mode === 'preview' ? previewResult(result) : result;
  }

  return withMaintenanceLock(async () => {
    options.signal?.throwIfAborted();
    const candidate = await database.$transaction((transaction) =>
      prepare(transaction, plan, expectedHash),
    );
    if (candidate.mode === 'already_applied') {
      return candidate;
    }
    if (candidate.planHash !== expectedHash) {
      throw new IngestionError('repair_plan_changed');
    }
    const backup = candidate.changes.length ? await options.backup() : null;

    const apply = () =>
      database.$transaction(
        async (transaction) => {
          options.signal?.throwIfAborted();
          const current = await prepare(transaction, plan, expectedHash);
          if (current.mode === 'already_applied') {
            return current;
          }
          if (current.planHash !== expectedHash) {
            throw new IngestionError('repair_plan_changed');
          }

          for (const { mutation } of current.prepared) {
            await mutation?.apply();
          }
          let marketRevision = current.revision;
          if (current.changes.length) {
            const next = await transaction.marketDataState.update({
              where: { key: 'global', revision: marketRevision },
              data: { revision: { increment: 1 } },
            });
            marketRevision = next.revision;
          }

          for (const [issueId, { issue, actions, mutations }] of current.issueActions) {
            const action = actions[0];
            const common = {
              issueId,
              marketRevision,
              reason: actions.map((entry) => entry.reason).join('\n'),
              evidence: [...new Set(actions.flatMap((entry) => entry.evidence))],
              receipt: { planHash: current.planHash, requestHash: current.requestHash },
            };
            if (action.op === 'accept') {
              await recordIssueResolution(transaction, { ...common, status: 'accepted' });
            } else if (action.op === 'reopen') {
              await recordIssueResolution(transaction, {
                ...common,
                status: 'pending',
                previousResolutionUpdatedAt: issue.resolution!.updatedAt.toISOString(),
              });
            } else {
              const rows = (side: 'before' | 'after') =>
                mutations.map((mutation) => ({
                  table: mutation.table,
                  key: mutation.key,
                  values:
                    mutation[side] &&
                    Object.fromEntries(
                      Object.entries(mutation[side]).filter(
                        ([field]) =>
                          !mutation.before ||
                          !mutation.after ||
                          Reflect.get(mutation.before, field) !==
                            Reflect.get(mutation.after, field),
                      ),
                    ),
                })) as ResolutionRows;
              await recordIssueResolution(transaction, {
                ...common,
                status: 'resolved',
                before: rows('before'),
                after: rows('after'),
              });
            }
          }
          options.signal?.throwIfAborted();

          return { ...previewResult(current), mode: 'applied' as const, marketRevision, backup };
        },
        { timeout: 120_000 },
      );

    return candidate.changes.length ? withMarketPublication(apply) : apply();
  });
}
