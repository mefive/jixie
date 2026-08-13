import { z } from 'zod';
import type { ResearchRunResultV1 } from '@jixie/shared';
import { chartSpecSchema } from './chart-spec.js';
import { researchPlanSpecV1Schema, universeSpecV1Schema } from '../research/spec.js';

const researchRunResultSchema = z.custom<ResearchRunResultV1>((value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const run = value as Partial<ResearchRunResultV1>;
  const plan = run.plan as unknown as { question?: unknown } | undefined;
  const currentPlan = researchPlanSpecV1Schema.safeParse(run.plan).success;
  const legacyPlan =
    typeof plan?.question === 'string' &&
    researchPlanSpecV1Schema.safeParse({
      ...run.plan,
      question: {
        version: 1,
        kind: 'time_series_relationship',
        text: plan.question,
        hypothesis: { estimand: 'regression_slope', direction: 'two_sided', nullValue: 0 },
      },
      outputs: [
        ...((run.plan as unknown as { outputs?: unknown[] } | undefined)?.outputs ?? []).filter(
          (output) =>
            !(
              typeof output === 'object' &&
              output != null &&
              (output as { kind?: unknown }).kind === 'conclusion'
            ),
        ),
        { kind: 'conclusion' },
      ],
    }).success;
  const conclusion = run.conclusion as unknown as { level?: unknown } | undefined;
  const currentProtocol = [
    'time_series_relationship',
    'distribution_comparison',
    'event_study',
  ].includes(run.protocol?.id ?? '');
  const protocolMatchesResult = run.protocol?.id === run.result?.kind;
  const conclusionIsCurrent = [
    'supports',
    'weak_support',
    'does_not_support',
    'indeterminate',
  ].includes(typeof conclusion?.level === 'string' ? conclusion.level : '');
  return (
    run.version === 1 &&
    (currentPlan || legacyPlan) &&
    (legacyPlan
      ? run.protocol?.id === 'time_series_relationship' &&
        run.result?.kind === 'time_series_relationship'
      : currentProtocol && protocolMatchesResult) &&
    Array.isArray(run.coverage) &&
    Array.isArray(run.diagnostics) &&
    (legacyPlan || conclusionIsCurrent)
  );
}, 'invalid research run');

const researchPartSchema = z.strictObject({
  type: z.literal('research'),
  title: z.string().max(120),
  run: researchRunResultSchema,
});

const universePartSchema = z.strictObject({
  type: z.literal('universe'),
  title: z.string().max(120),
  spec: universeSpecV1Schema,
});

/** Wire validation for parts-shaped agent conversations (shared by strategy / factor / screen routes).
 * The frontend normalizes legacy `{ role, content }` rows on read, so the API only accepts the new shape. */
export const messagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(8000) }),
  z.object({ type: z.literal('chart'), title: z.string().max(120), chart: chartSpecSchema }),
  researchPartSchema,
  universePartSchema,
]);

export const chatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema).min(1).max(20),
  turnId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
});

export const chatMessagesSchema = z.array(chatMessageSchema).max(60);
