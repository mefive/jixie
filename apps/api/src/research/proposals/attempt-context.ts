const MAX_RESEARCH_AGENT_ATTEMPT_CHARACTERS = 32_000;

/**
 * 为 Agent 汇总已执行修改尝试及差异，供修复决策复用证据。
 *
 * Summarize prior cell-change attempts and differences for evidence-based agent repair.
 */
export function researchAgentCellChangeAttemptContext(attempt: {
  id: string;
  proposalId: string;
  contentRevision: number;
  scope: string;
  status: string;
  rootCellIds: unknown;
  plannedCellIds: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  executions: Array<{
    id: string;
    cellId: string | null;
    sourceCellId: string | null;
    sourcePosition: number | null;
    sourceKind: string | null;
    revision: number;
    status: string;
    output: unknown;
    error: string | null;
    cell: { kind: string; position: number } | null;
  }>;
}): string {
  let remainingCharacters = MAX_RESEARCH_AGENT_ATTEMPT_CHARACTERS;

  /**
   * 在共享字数预算内裁剪尝试源码与输出，供 Agent 修复上下文。
   *
   * Bound attempt output under a shared context character budget.
   */
  const executions = attempt.executions.map((execution) => {
    const serializedOutput = JSON.stringify(execution.output ?? null);
    const outputCharacters = Math.min(6_000, remainingCharacters, serializedOutput.length);
    const outputText = serializedOutput.slice(0, outputCharacters);
    remainingCharacters -= outputCharacters;
    return {
      executionId: execution.id,
      cellId: execution.sourceCellId ?? execution.cellId,
      position: execution.sourcePosition ?? execution.cell?.position,
      kind: execution.sourceKind ?? execution.cell?.kind,
      revision: execution.revision,
      status: execution.status,
      output:
        outputText.length === serializedOutput.length
          ? JSON.parse(outputText)
          : { jsonPrefix: outputText, truncated: true },
      ...(execution.error ? { error: execution.error } : {}),
    };
  });
  return JSON.stringify({
    version: 1,
    attemptId: attempt.id,
    proposalId: attempt.proposalId,
    contentRevision: attempt.contentRevision,
    scope: attempt.scope,
    status: attempt.status,
    rootCellIds: attempt.rootCellIds,
    plannedCellIds: attempt.plannedCellIds,
    executions,
    ...(attempt.error ? { error: attempt.error } : {}),
    startedAt: attempt.startedAt.toISOString(),
    ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt.toISOString() } : {}),
  });
}
