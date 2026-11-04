import { z } from 'zod';
import { marketRepairSchema } from '#market/synchronization/repair-schema.js';

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(100);
const common = {
  issueIds: z.array(id).min(1).max(100),
  reason: z.string().trim().min(1).max(4000),
  evidence: z.array(z.string().trim().min(1).max(4000)).min(1).max(25),
};
const accept = z.strictObject({ ...common, op: z.literal('accept') });
const reopen = z.strictObject({
  ...common,
  op: z.literal('reopen'),
  expectedResolutionVersion: z.iso.datetime(),
});
const mutations = marketRepairSchema.options.map((schema) => schema.extend(common));
const action = z.union([accept, reopen, ...mutations]);

export const issueRepairPlanSchema = z.strictObject({
  runId: id,
  actions: z.array(action).min(1).max(100),
});
export type IssueRepairPlan = z.output<typeof issueRepairPlanSchema>;

/** 用相同校验定义生成导出契约。 / Generate export instructions from the input validators. */
export function describeIssueRepairPlan(datasets: ReadonlySet<string>) {
  return z.toJSONSchema(
    issueRepairPlanSchema.extend({
      actions: z
        .array(
          z.union([
            accept,
            reopen,
            ...mutations.filter((schema) => datasets.has(schema.shape.dataset.value)),
          ]),
        )
        .min(1)
        .max(100),
    }),
  );
}

export const repairReceiptSchema = z.object({
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
