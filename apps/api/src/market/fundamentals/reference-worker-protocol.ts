import type { ReferenceSyncSummary } from './reference-sync.js';

export type ReferenceWorkerStage = 'financial_statements' | 'financials' | 'dividends';

/**
 * 区分子进程进度、完成和错误帧，供父进程安全持久化。
 * Discriminate worker progress, completion and error frames for host persistence.
 */
export type ReferenceWorkerMessage =
  | { type: 'reference-worker-item'; item: string }
  | { type: 'reference-worker-summary'; summary: ReferenceSyncSummary };

/**
 * 确认某项结果已被父进程持久接受，允许 Worker 继续。
 * Acknowledge durable host acceptance before the worker continues.
 */
export interface ReferenceWorkerAcknowledgement {
  type: 'reference-worker-acknowledged';
  item: string;
}

/**
 * 检查子进程消息是否符合财报同步协议，再交给宿主持久化。
 * Validate a financial reference worker message before host persistence.
 */
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
