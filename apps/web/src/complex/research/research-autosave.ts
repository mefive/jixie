export const RESEARCH_AUTOSAVE_TICK_MS = 500;
export const RESEARCH_AUTOSAVE_QUIET_MS = 800;
export const RESEARCH_AUTOSAVE_MAX_DIRTY_MS = 5_000;

export type ResearchCellSaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface ResearchCellDraftState {
  cellId: string;
  draft: string;
  persistedSource: string;
  expectedRevision: number;
  status: ResearchCellSaveStatus;
  dirtySince: number | null;
  lastChangedAt: number | null;
}

export function savedResearchCellDraft(
  cellId: string,
  source: string,
  revision: number,
): ResearchCellDraftState {
  return {
    cellId,
    draft: source,
    persistedSource: source,
    expectedRevision: revision,
    status: 'saved',
    dirtySince: null,
    lastChangedAt: null,
  };
}

export function editResearchCellDraft(
  current: ResearchCellDraftState,
  draft: string,
  now: number,
): ResearchCellDraftState {
  if (draft === current.persistedSource) {
    return {
      ...current,
      draft,
      status: 'saved',
      dirtySince: null,
      lastChangedAt: null,
    };
  }
  return {
    ...current,
    draft,
    status: 'dirty',
    dirtySince: current.dirtySince ?? now,
    lastChangedAt: now,
  };
}

export function researchCellDraftIsDue(draft: ResearchCellDraftState, now: number): boolean {
  if (draft.status !== 'dirty' || draft.dirtySince === null || draft.lastChangedAt === null) {
    return false;
  }
  return (
    now - draft.lastChangedAt >= RESEARCH_AUTOSAVE_QUIET_MS ||
    now - draft.dirtySince >= RESEARCH_AUTOSAVE_MAX_DIRTY_MS
  );
}
