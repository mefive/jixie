import type { z } from 'zod';
import type { factorQuestionSchema } from './api/factor.js';
import type { ChatMessage } from './chat.js';
import type { FactorReportSummary } from './factor.js';

/**
 * 冻结问答使用的确切定义与有界报告摘要，避免切换上下文漂移。
 *
 * The exact saved definition and bounded report summary supplied to one question turn.
 */
export interface FactorQuestionContextV1 {
  version: 1;
  capturedAt: string;
  factor: {
    key: string;
    name: string;
    kind: 'factor' | 'template';
    analysisKind: string;
    language: string;
    source: string;
    sourceHash: string;
  };
  report: {
    id: string;
    contentHash: string;
    summary: FactorReportSummary;
    factorCodeSnapshot: string | null;
    factorCodeHash: string | null;
    dataRevision: string | null;
  } | null;
}

export type FactorQuestionInputV1 = z.input<typeof factorQuestionSchema>;

/**
 * 描述一次问答的身份、状态与固定证据。
 *
 * Describe a Q&A turn's identity, state and fixed evidence.
 */
export interface FactorQuestionTurnV1 {
  conversationId: string;
  turnId: string;
  message: ChatMessage;
}

/**
 * 组合问答历史与分页信息，供重连恢复。
 *
 * Collect Q&A history and pagination for restoration.
 */
export interface FactorQuestionHistoryV1 {
  conversationId: string | null;
  messages: ChatMessage[];
  nextBefore: number | null;
  activeTurnId: string | null;
}
