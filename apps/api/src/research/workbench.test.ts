import { describe, expect, it } from 'vitest';
import {
  affectedResearchCellRunPlan,
  downstreamResearchCellIds,
  executeAffectedResearchCellPlan,
  ResearchAffectedRunError,
} from './workbench.js';

describe('reactive research dependencies', () => {
  it('marks transitive dependents without invalidating independent Markdown cells', () => {
    const stale = downstreamResearchCellIds('load', new Set(['monthly']), [
      { cellId: 'load', definitions: ['monthly'], references: [] },
      { cellId: 'summary', definitions: ['correlation'], references: ['monthly'] },
      { cellId: 'chart', definitions: ['figure'], references: ['correlation'] },
      { cellId: 'notes', definitions: [], references: [] },
    ]);

    expect(stale).toEqual(['summary', 'chart']);
  });

  it('uses removed definitions as stale seeds', () => {
    const stale = downstreamResearchCellIds('load', new Set(['oldFrame']), [
      { cellId: 'load', definitions: ['newFrame'], references: [] },
      { cellId: 'consumer', definitions: [], references: ['oldFrame'] },
    ]);

    expect(stale).toEqual(['consumer']);
  });

  it('keeps transitive dependents in document order', () => {
    const stale = downstreamResearchCellIds('load', new Set(['late', 'early']), [
      { cellId: 'load', definitions: ['late', 'early'], references: [] },
      { cellId: 'first', definitions: [], references: ['early'] },
      { cellId: 'second', definitions: [], references: ['late'] },
    ]);

    expect(stale).toEqual(['first', 'second']);
  });

  it('orders an affected diamond while excluding independent cells', () => {
    const plan = affectedResearchCellRunPlan('load', [
      {
        cellId: 'combined',
        definitions: ['combinedSummary'],
        references: ['leftSummary', 'rightSummary'],
      },
      { cellId: 'left', definitions: ['leftSummary'], references: ['monthly'] },
      { cellId: 'independent', definitions: ['other'], references: [] },
      { cellId: 'load', definitions: ['monthly'], references: [] },
      { cellId: 'right', definitions: ['rightSummary'], references: ['monthly'] },
    ]);

    expect(plan.cellIds).toEqual(['load', 'left', 'right', 'combined']);
    expect(plan.dependenciesByCellId.get('combined')).toEqual(['left', 'right']);
  });

  it('unions multiple changed roots and keeps one topological order', () => {
    const plan = affectedResearchCellRunPlan(
      ['left-load', 'right-load'],
      [
        { cellId: 'left-load', definitions: ['left'], references: [] },
        { cellId: 'right-load', definitions: ['right'], references: [] },
        { cellId: 'left-summary', definitions: ['leftMean'], references: ['left'] },
        { cellId: 'combined', definitions: [], references: ['leftMean', 'right'] },
        { cellId: 'independent', definitions: ['other'], references: [] },
      ],
    );

    expect(plan.cellIds).toEqual(['left-load', 'right-load', 'left-summary', 'combined']);
    expect(plan.dependenciesByCellId.get('combined')).toEqual(['left-summary', 'right-load']);
  });

  it('rejects duplicate definitions used by the affected branch', () => {
    expect(() =>
      affectedResearchCellRunPlan('load-a', [
        { cellId: 'load-a', definitions: ['monthly'], references: [] },
        { cellId: 'load-b', definitions: ['monthly'], references: [] },
        { cellId: 'summary', definitions: [], references: ['monthly'] },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<ResearchAffectedRunError>>({
        reason: 'duplicate_definitions',
      }),
    );
  });

  it('rejects cycles in the affected branch', () => {
    expect(() =>
      affectedResearchCellRunPlan('left', [
        { cellId: 'left', definitions: ['leftValue'], references: ['rightValue'] },
        { cellId: 'right', definitions: ['rightValue'], references: ['leftValue'] },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<ResearchAffectedRunError>>({ reason: 'cyclic_dependency' }),
    );
  });

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
