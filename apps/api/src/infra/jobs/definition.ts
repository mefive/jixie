import type { Job, Prisma } from '@prisma/client';
import type { LogLine } from '@jixie/shared';
import type { JobKind } from './records.js';

export type JobSnapshot = Job;
export interface JobExecutionContext {
  job: JobSnapshot;
  log(entry: LogLine): void;
}

export interface JobFailure {
  message: string;
  phase: 'input' | 'execution' | 'completion';
}

export interface JobDefinition<Input, Output> {
  parse(raw: unknown, job: JobSnapshot): Input;
  execute(context: JobExecutionContext, input: Input): Promise<Output>;
  complete(
    transaction: Prisma.TransactionClient,
    job: JobSnapshot,
    input: Input,
    output: Output,
  ): Promise<void>;
  fail(
    transaction: Prisma.TransactionClient,
    jobs: readonly JobSnapshot[],
    failure: JobFailure,
  ): Promise<void>;
  recover(transaction: Prisma.TransactionClient, jobs: readonly JobSnapshot[]): Promise<void>;
  afterCommit?(context: JobExecutionContext, input: Input, status: 'done' | 'error'): Promise<void>;
}

export interface JobResult {
  complete(transaction: Prisma.TransactionClient): Promise<void>;
}

export interface PreparedJob {
  execute(): Promise<JobResult>;
  afterCommit(status: 'done' | 'error'): Promise<void>;
}

export interface RegisteredJobDefinition {
  prepare(context: JobExecutionContext): PreparedJob;
  fail: JobDefinition<unknown, unknown>['fail'];
  recover: JobDefinition<unknown, unknown>['recover'];
}

export type JobRegistry = Record<JobKind, () => Promise<RegisteredJobDefinition>>;

// Capture typed input/output in closures so the heterogeneous registry needs no casts.
export function defineJob<Input, Output>(
  definition: JobDefinition<Input, Output>,
): RegisteredJobDefinition {
  return {
    prepare(context) {
      const input = definition.parse(context.job.payload, context.job);
      return {
        async execute() {
          const output = await definition.execute(context, input);
          return {
            complete: (transaction) => definition.complete(transaction, context.job, input, output),
          };
        },
        async afterCommit(status) {
          await definition.afterCommit?.(context, input, status);
        },
      };
    },
    fail: (transaction, jobs, failure) => definition.fail(transaction, jobs, failure),
    recover: (transaction, jobs) => definition.recover(transaction, jobs),
  };
}
