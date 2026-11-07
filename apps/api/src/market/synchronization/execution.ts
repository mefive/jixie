import { z } from 'zod';

/** 批次执行分段计时，不承担覆盖证明。 / Execution timings never establish source coverage. */
export const sourceExecutionSchema = z.object({
  sourceStartedAt: z.string().datetime().nullable(),
  sourceFinishedAt: z.string().datetime().nullable(),
  downloadMs: z.number().nonnegative(),
  rateLimitMs: z.number().nonnegative(),
  queueMs: z.number().nonnegative(),
  prepareMs: z.number().nonnegative(),
  writeMs: z.number().nonnegative().nullable(),
  httpRequests: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
});
export type SourceExecution = z.infer<typeof sourceExecutionSchema>;

/** 兼容旧数组收据及带执行元数据的新信封。 / Accept legacy arrays and versioned execution envelopes. */
export function sourceRequests(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version === 2 &&
    'requests' in value &&
    Array.isArray(value.requests)
  ) {
    return value.requests;
  }

  return undefined;
}

export function sourceExecution(value: unknown): SourceExecution | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 2 ||
    !('execution' in value)
  ) {
    return null;
  }
  const parsed = sourceExecutionSchema.safeParse(value.execution);

  return parsed.success ? parsed.data : null;
}

/** 排队时间不参与披露覆盖日期推断。 / Queue time cannot establish disclosure capture dates. */
export function sourceCaptureStartedAt(batch: { request: unknown; startedAt: Date }): Date {
  const captured = sourceExecution(batch.request)?.sourceStartedAt;

  return captured ? new Date(captured) : batch.startedAt;
}
