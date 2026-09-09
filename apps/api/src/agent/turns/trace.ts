import type { Prisma } from '@prisma/client';
import type { AgentTraceStep, AgentTurnTrace } from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../../infra/database/prisma.js';

export class AgentTraceRecorder {
  public readonly trace: AgentTurnTrace = { version: 1, steps: [], truncated: false };
  private checkpoint = Promise.resolve();
  private modelStartedAt = new Map<number, number>();
  private reasoning = new Map<number, string>();

  public constructor(
    private readonly turnId: string,
    private readonly model: string,
  ) {}

  public modelStart(modelCall: number, toolsEnabled: string[]): void {
    this.modelStartedAt.set(modelCall, Date.now());
    this.push({
      type: 'model',
      modelCall,
      model: this.model,
      toolsEnabled,
      status: 'running',
    });
  }

  public reasoningDelta(modelCall: number, text: string): void {
    this.reasoning.set(modelCall, (this.reasoning.get(modelCall) ?? '') + text);
  }

  public modelDone(modelCall: number): void {
    const step = [...this.trace.steps]
      .reverse()
      .find((candidate) => candidate.type === 'model' && candidate.modelCall === modelCall);
    if (step?.type === 'model') {
      step.reasoning = this.reasoning.get(modelCall);
      step.status = 'success';
      step.durationMs = Date.now() - (this.modelStartedAt.get(modelCall) ?? Date.now());
      this.queueCheckpoint();
    }
  }

  public tool(args: {
    modelCall: number;
    toolCallId: string;
    name: string;
    arguments: string;
    observation: string;
    ok: boolean;
    rows?: number;
    durationMs: number;
  }): void {
    this.push({ type: 'tool', ...args });
  }

  public validation(round: number, ok: boolean, durationMs: number, error?: string): void {
    this.push({ type: 'validation', round, ok, durationMs, error });
  }

  public terminal(type: 'error' | 'cancelled', message?: string): void {
    this.push({ type, message });
  }

  public async flush(): Promise<void> {
    await this.checkpoint;
  }

  private push(step: TraceStepInput): void {
    this.trace.steps.push({
      ...step,
      id: ulid(),
      sequence: this.trace.steps.length,
      createdAt: new Date().toISOString(),
    } as AgentTraceStep);
    this.queueCheckpoint();
  }

  private queueCheckpoint(): void {
    this.checkpoint = this.checkpoint
      .then(() =>
        prisma.agentTurn.updateMany({
          where: { id: this.turnId, status: 'running' },
          data: { trace: this.trace as unknown as Prisma.InputJsonValue },
        }),
      )
      .then(() => undefined);
  }
}

type TraceStepInput = AgentTraceStep extends infer Step
  ? Step extends AgentTraceStep
    ? Omit<Step, 'id' | 'sequence' | 'createdAt'>
    : never
  : never;
