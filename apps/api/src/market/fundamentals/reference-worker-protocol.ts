import type { ReferenceSyncSummary } from './reference-sync.js';

export type ReferenceWorkerStage = 'financial_statements' | 'financials' | 'dividends';

export type ReferenceWorkerMessage =
  | { type: 'reference-worker-item'; item: string }
  | { type: 'reference-worker-summary'; summary: ReferenceSyncSummary };

export interface ReferenceWorkerAcknowledgement {
  type: 'reference-worker-acknowledged';
  item: string;
}

export function isReferenceWorkerMessage(message: unknown): message is ReferenceWorkerMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const candidate = message as Partial<ReferenceWorkerMessage>;
  if (candidate.type === 'reference-worker-item') {
    return typeof candidate.item === 'string';
  }
  if (candidate.type !== 'reference-worker-summary' || !candidate.summary) {
    return false;
  }
  return ['requested', 'skipped', 'processed', 'changed', 'created', 'updated', 'deleted'].every(
    (key) => {
      const count = (candidate.summary as unknown as Record<string, unknown>)[key];
      return typeof count === 'number' && Number.isFinite(count) && count >= 0;
    },
  );
}
