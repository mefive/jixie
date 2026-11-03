import { AsyncLocalStorage } from 'node:async_hooks';

export interface ImportIssue {
  severity?: 'error' | 'warning';
  category: 'request' | 'record' | 'snapshot' | 'dependency' | 'internal';
  reasonCode: string;
  message: string;
  businessKey?: unknown;
  field?: string;
  payload?: unknown;
}

export interface ImportDiagnostics {
  requests: Array<{ api: string; params: Record<string, unknown>; fields: string }>;
  issues: ImportIssue[];
}

const imports = new AsyncLocalStorage<ImportDiagnostics>();

/**
 * 未指定级别的既有诊断继续表示错误；警告不参与阻塞判断。
 *
 * Existing diagnostics default to errors; warnings never block batch completion.
 */
export function isImportError(issue: ImportIssue): boolean {
  return issue.severity !== 'warning';
}

/**
 * 领域映射与事务写入共享本批诊断，不依赖采集调度模块。
 *
 * Share batch diagnostics between domain mapping and writes without importing the orchestrator.
 */
export function withImportDiagnostics<Result>(
  diagnostics: ImportDiagnostics,
  operation: () => Promise<Result>,
): Promise<Result> {
  return imports.run(diagnostics, operation);
}

export function recordImportIssue(issue: ImportIssue): void {
  imports.getStore()?.issues.push(issue);
}

export function recordImportRequest(
  api: string,
  params: Record<string, unknown>,
  fields: string,
): void {
  imports.getStore()?.requests.push({ api, params, fields });
}
