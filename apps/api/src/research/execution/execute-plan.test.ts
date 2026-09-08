import { describe, expect, it } from 'vitest';
import { affectedResearchCellRunPlan } from '../dependencies/run-plan.js';
import { executeAffectedResearchCellPlan } from './execute-plan.js';

describe('Research affected-plan execution', () => {
  it('continues independent branches and skips dependents of a failed cell', async () => {
    const plan = affectedResearchCellRunPlan('load', [
      { cellId: 'load', definitions: ['monthly'], references: [] },
      { cellId: 'failed-branch', definitions: ['failedValue'], references: ['monthly'] },
      { cellId: 'healthy-branch', definitions: ['healthyValue'], references: ['monthly'] },
      { cellId: 'blocked', definitions: [], references: ['failedValue'] },
      { cellId: 'healthy-result', definitions: [], references: ['healthyValue'] },
    ]);
    const attempted: string[] = [];

    const executed = await executeAffectedResearchCellPlan(plan, async (cellId) => {
      attempted.push(cellId);
      return cellId !== 'failed-branch';
    });

    expect(executed).toEqual(['load', 'failed-branch', 'healthy-branch', 'healthy-result']);
    expect(attempted).not.toContain('blocked');
  });

  it('does not start another affected cell after interruption', async () => {
    const plan = affectedResearchCellRunPlan('load', [
      { cellId: 'load', definitions: ['monthly'], references: [] },
      { cellId: 'summary', definitions: ['summary'], references: ['monthly'] },
      { cellId: 'chart', definitions: [], references: ['summary'] },
    ]);
    let interrupted = false;

    const executed = await executeAffectedResearchCellPlan(
      plan,
      async (cellId) => {
        interrupted = cellId === 'load';
        return true;
      },
      () => interrupted,
    );

    expect(executed).toEqual(['load']);
  });
});
