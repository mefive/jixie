import {
  renderFactorPythonSdkStub,
  renderResearchSdkPythonStub,
  type ResearchLanguageCompletionItemV1,
  type ResearchLanguageDiagnosticV1,
  type ResearchLanguageHoverV1,
  type ResearchLanguageLocationV1,
  type ResearchLanguagePositionV1,
  type ResearchLanguageRangeV1,
  type ResearchLanguageRequestV1,
  type ResearchLanguageResultV1,
  type ResearchLanguageSignatureHelpV1,
  type ResearchLanguageTextEditV1,
} from '@jixie/shared';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JsonRpcResponseError, ResearchError } from '../errors.js';
import {
  buildResearchLanguageDocument,
  researchCellPositionToVirtual,
  researchVirtualRangeToCell,
  type ResearchLanguageDocument,
} from './document.js';
import { RESEARCH_LANGUAGE_LIBRARY_STUBS } from './stubs.js';

type JsonRpcId = number | string;

/**
 * 约束 JSON-RPC 请求、响应与通知，供 Pyright 通信。
 *
 * Describe JSON-RPC requests, responses and notifications for Pyright communication.
 */
interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * 保存 LSP 零基行列位置，供 Cell 映射。
 *
 * Describe zero-based LSP positions for cell mapping.
 */
interface LspPosition {
  line: number;
  character: number;
}

/**
 * 定义 LSP 源码范围，供文本编辑和诊断。
 *
 * Describe LSP source ranges for edits and diagnostics.
 */
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/**
 * 承载 Pyright 原始诊断，供公开语言结果规范化。
 *
 * Describe raw Pyright diagnostics before public normalization.
 */
interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

/**
 * 维护已打开文档内容与版本，供请求和诊断关联。
 *
 * Track open document content and versions for request and diagnostic association.
 */
interface OpenResearchLanguageDocument {
  uri: string;
  version: number;
  text: string;
  document: ResearchLanguageDocument;
  lastUsedAt: number;
}

/**
 * 保存某文档版本发布的诊断，避免应用陈旧结果。
 *
 * Associate published diagnostics with a document revision.
 */
interface PublishedDiagnostics {
  version: number;
  diagnostics: LspDiagnostic[];
}

/**
 * 登记等待诊断的版本与清理，供有界异步请求。
 *
 * Track a bounded diagnostic wait and its cleanup.
 */
interface DiagnosticWaiter {
  minimumVersion: number;
  resolve: (diagnostics: LspDiagnostic[]) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const MAX_OPEN_DOCUMENTS = 24;
const DIAGNOSTIC_WAIT_MS = 2_500;
const LANGUAGE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Persistent Pyright process for Research documents. Each logical document is sent as one virtual
 * Python module, so symbols declared by an upstream Cell are visible in downstream Cells.
 */
export class ResearchPythonLanguageService {
  private workspacePath: string | null = null;
  private connection: JsonRpcStdioConnection | null = null;
  private initialization: Promise<void> | null = null;
  private documents = new Map<string, OpenResearchLanguageDocument>();
  private diagnostics = new Map<string, PublishedDiagnostics>();
  private diagnosticWaiters = new Map<string, DiagnosticWaiter[]>();

  /**
   * 发送带身份的 JSON-RPC 请求，并管理响应等待、超时与取消。
   *
   * Send an identified JSON-RPC request with response waiting, timeout and cancellation handling.
   */
  public async request(
    sessionKey: string,
    request: ResearchLanguageRequestV1,
  ): Promise<ResearchLanguageResultV1> {
    await this.initialize();
    const opened = await this.openDocument(sessionKey, request.cells);

    if (request.action === 'diagnostics') {
      const diagnostics = await this.waitForDiagnostics(opened);
      return {
        version: 1,
        action: 'diagnostics',
        result: diagnostics.flatMap((diagnostic) =>
          normalizeDiagnostic(opened.document, diagnostic),
        ),
      };
    }

    const position = request.position
      ? researchCellPositionToVirtual(opened.document, request.cellId, request.position)
      : null;
    if (!position) {
      throw new ResearchError('language_position_invalid');
    }

    switch (request.action) {
      case 'completion':
        return this.completion(opened, position);
      case 'hover':
        return this.hover(opened, position);
      case 'signature_help':
        return this.signatureHelp(opened, position);
      case 'definition':
        return this.locations('textDocument/definition', 'definition', opened, position);
      case 'references':
        return this.locations('textDocument/references', 'references', opened, position, {
          context: { includeDeclaration: true },
        });
      case 'prepare_rename':
        return this.prepareRename(opened, position);
      case 'rename':
        if (!request.newName) {
          throw new ResearchError('language_rename_invalid');
        }
        return this.rename(opened, position, request.newName);
    }
  }

  /**
   * 关闭语言服务子进程并拒绝未完成请求，释放监听资源。
   *
   * Dispose the language-service process and reject pending requests while releasing listeners.
   */
  public async dispose(): Promise<void> {
    for (const waiters of this.diagnosticWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve([]);
      }
    }
    this.diagnosticWaiters.clear();
    const connection = this.connection;
    const workspacePath = this.workspacePath;
    this.connection = null;
    this.workspacePath = null;
    this.initialization = null;
    this.documents.clear();
    this.diagnostics.clear();
    if (connection) {
      await connection.shutdown();
    }
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  }

  /**
   * 完成 LSP 初始化并声明客户端能力，供后续语言请求。
   *
   * Initialize LSP capabilities before language requests.
   */
  private async initialize(): Promise<void> {
    if (this.connection) {
      return;
    }
    if (this.initialization) {
      return this.initialization;
    }
    this.initialization = this.start().catch((error) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  /**
   * 启动 Pyright 语言服务并完成初始化，接入消息与退出处理。
   *
   * Start and initialize the Pyright language service with message and exit handling.
   */
  private async start(): Promise<void> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'jixie-research-language-'));
    const typingsPath = join(workspacePath, 'typings');
    await mkdir(join(workspacePath, 'documents'), { recursive: true });
    await writeLanguageStub(
      join(typingsPath, 'jixie_research_sdk.pyi'),
      renderResearchSdkPythonStub(),
    );
    await writeLanguageStub(
      join(typingsPath, 'jixie', '__init__.pyi'),
      renderFactorPythonSdkStub(),
    );
    await Promise.all(
      Object.entries(RESEARCH_LANGUAGE_LIBRARY_STUBS).map(([path, source]) =>
        writeLanguageStub(join(typingsPath, path), source),
      ),
    );
    await writeFile(
      join(workspacePath, 'pyrightconfig.json'),
      `${JSON.stringify(
        {
          typeCheckingMode: 'basic',
          pythonVersion: '3.13',
          stubPath: 'typings',
          include: ['documents'],
          reportMissingImports: 'none',
          reportMissingModuleSource: 'none',
          reportMissingTypeStubs: 'none',
          useLibraryCodeForTypes: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const require = createRequire(import.meta.url);
    const pyrightPackagePath = require.resolve('pyright/package.json');
    const serverPath = join(dirname(pyrightPackagePath), 'langserver.index.js');
    const child = spawn(process.execPath, [serverPath, '--stdio'], {
      cwd: workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const connection = new JsonRpcStdioConnection(
      child,
      (message) => this.handleNotification(message),
      () => {
        if (this.connection === connection) {
          this.connection = null;
          this.initialization = null;
          this.documents.clear();
          this.diagnostics.clear();
        }
      },
    );
    await connection.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'jixie-research', version: '1' },
      rootUri: pathToFileURL(workspacePath).href,
      workspaceFolders: [{ uri: pathToFileURL(workspacePath).href, name: 'jixie-research' }],
      capabilities: {
        workspace: {
          configuration: true,
          workspaceFolders: true,
          workspaceEdit: { documentChanges: true },
        },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true },
            },
          },
          definition: { linkSupport: true },
          references: {},
          rename: { prepareSupport: true },
          publishDiagnostics: { versionSupport: true },
        },
      },
    });
    connection.notify('initialized', {});
    this.workspacePath = workspacePath;
    this.connection = connection;
  }

  /**
   * 打开或更新合成文档，建立文档修订与诊断关联。
   *
   * Open or update a synthesized document and associate revisions with diagnostics.
   */
  private async openDocument(
    sessionKey: string,
    cells: ResearchLanguageRequestV1['cells'],
  ): Promise<OpenResearchLanguageDocument> {
    const connection = this.requiredConnection();
    const workspacePath = this.workspacePath!;
    const document = buildResearchLanguageDocument(cells);
    const key = createHash('sha256').update(sessionKey).digest('hex').slice(0, 32);
    const uri = pathToFileURL(join(workspacePath, 'documents', `${key}.py`)).href;
    const current = this.documents.get(sessionKey);
    if (!current) {
      const opened = {
        uri,
        version: 1,
        text: document.text,
        document,
        lastUsedAt: Date.now(),
      };
      this.documents.set(sessionKey, opened);
      connection.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: 'python',
          version: opened.version,
          text: opened.text,
        },
      });
      this.trimDocuments(sessionKey);
      return opened;
    }

    current.lastUsedAt = Date.now();
    if (current.text !== document.text) {
      current.version += 1;
      current.text = document.text;
      current.document = document;
      connection.notify('textDocument/didChange', {
        textDocument: { uri: current.uri, version: current.version },
        contentChanges: [{ text: current.text }],
      });
    } else {
      current.document = document;
    }
    return current;
  }

  /**
   * 关闭超出缓存限制的旧文档，释放语言服务资源。
   *
   * Evict old language documents beyond cache limits.
   */
  private trimDocuments(activeSessionKey: string): void {
    if (this.documents.size <= MAX_OPEN_DOCUMENTS) {
      return;
    }
    const oldest = [...this.documents.entries()]
      .filter(([key]) => key !== activeSessionKey)
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
    if (!oldest) {
      return;
    }
    this.requiredConnection().notify('textDocument/didClose', {
      textDocument: { uri: oldest[1].uri },
    });
    this.documents.delete(oldest[0]);
    this.diagnostics.delete(oldest[1].uri);
  }

  /**
   * 打开当前合成文档后请求补全，规范化响应和编辑范围。
   *
   * Open the synthesized document and request normalized completions.
   */
  private async completion(
    opened: OpenResearchLanguageDocument,
    position: ResearchLanguagePositionV1,
  ): Promise<ResearchLanguageResultV1> {
    const raw = await this.requiredConnection().request('textDocument/completion', {
      textDocument: { uri: opened.uri },
      position,
      context: { triggerKind: 1 },
    });
    let items: unknown[] = [];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (isRecord(raw) && Array.isArray(raw.items)) {
      items = raw.items;
    }
    return {
      version: 1,
      action: 'completion',
      result: {
        incomplete: isRecord(raw) && raw.isIncomplete === true,
        items: items.flatMap((item) => normalizeCompletion(opened.document, item)),
      },
    };
  }

  private async hover(
    opened: OpenResearchLanguageDocument,
    position: ResearchLanguagePositionV1,
  ): Promise<ResearchLanguageResultV1> {
    const raw = await this.requiredConnection().request('textDocument/hover', {
      textDocument: { uri: opened.uri },
      position,
    });
    return {
      version: 1,
      action: 'hover',
      result: normalizeHover(opened.document, raw),
    };
  }

  private async signatureHelp(
    opened: OpenResearchLanguageDocument,
    position: ResearchLanguagePositionV1,
  ): Promise<ResearchLanguageResultV1> {
    const raw = await this.requiredConnection().request('textDocument/signatureHelp', {
      textDocument: { uri: opened.uri },
      position,
    });
    return {
      version: 1,
      action: 'signature_help',
      result: normalizeSignatureHelp(raw),
    };
  }

  /**
   * 请求定义或引用位置并过滤无效响应，供 Cell 导航。
   *
   * Request and normalize definition or reference locations for cell navigation.
   */
  private async locations(
    method: 'textDocument/definition' | 'textDocument/references',
    action: 'definition' | 'references',
    opened: OpenResearchLanguageDocument,
    position: ResearchLanguagePositionV1,
    extra: Record<string, unknown> = {},
  ): Promise<ResearchLanguageResultV1> {
    const raw = await this.requiredConnection().request(method, {
      textDocument: { uri: opened.uri },
      position,
      ...extra,
    });
    const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return {
      version: 1,
      action,
      result: entries.flatMap((entry) => normalizeLocation(opened, entry)),
    } as ResearchLanguageResultV1;
  }

  private async prepareRename(
    opened: OpenResearchLanguageDocument,
    position: ResearchLanguagePositionV1,
  ): Promise<ResearchLanguageResultV1> {
    try {
      const raw = await this.requiredConnection().request('textDocument/prepareRename', {
        textDocument: { uri: opened.uri },
        position,
      });
      const prepared = normalizeRenamePreparation(opened.document, raw);
      return { version: 1, action: 'prepare_rename', result: prepared };
    } catch (error) {
      if (error instanceof JsonRpcResponseError) {
        return { version: 1, action: 'prepare_rename', result: null };
      }
      throw error;
    }
  }

  private async rename(
    opened: OpenResearchLanguageDocument,
    position: ResearchLanguagePositionV1,
    newName: string,
  ): Promise<ResearchLanguageResultV1> {
    const raw = await this.requiredConnection().request('textDocument/rename', {
      textDocument: { uri: opened.uri },
      position,
      newName,
    });
    return {
      version: 1,
      action: 'rename',
      result: normalizeWorkspaceEdit(opened, raw),
    };
  }

  /**
   * 处理诊断等语言服务通知，唤醒等待对应文档版本的调用方。
   *
   * Handle language notifications and wake callers waiting for matching document diagnostics.
   */
  private handleNotification(message: JsonRpcMessage): void {
    if (message.method !== 'textDocument/publishDiagnostics' || !isRecord(message.params)) {
      return;
    }
    const uri = stringValue(message.params.uri);
    const diagnostics = Array.isArray(message.params.diagnostics)
      ? message.params.diagnostics.filter(isLspDiagnostic)
      : [];
    if (!uri) {
      return;
    }
    const opened = [...this.documents.values()].find((candidate) => candidate.uri === uri);
    const version = numberValue(message.params.version) ?? opened?.version ?? 0;
    this.diagnostics.set(uri, { version, diagnostics });
    const waiters = this.diagnosticWaiters.get(uri) ?? [];
    const remaining: DiagnosticWaiter[] = [];
    for (const waiter of waiters) {
      if (version >= waiter.minimumVersion) {
        clearTimeout(waiter.timeout);
        waiter.resolve(diagnostics);
      } else {
        remaining.push(waiter);
      }
    }
    if (remaining.length > 0) {
      this.diagnosticWaiters.set(uri, remaining);
    } else {
      this.diagnosticWaiters.delete(uri);
    }
  }

  private waitForDiagnostics(opened: OpenResearchLanguageDocument): Promise<LspDiagnostic[]> {
    const current = this.diagnostics.get(opened.uri);
    if (current && current.version >= opened.version) {
      return Promise.resolve(current.diagnostics);
    }
    return new Promise((resolve) => {
      const waiter: DiagnosticWaiter = {
        minimumVersion: opened.version,
        resolve,
        timeout: setTimeout(() => {
          const waiters = this.diagnosticWaiters.get(opened.uri) ?? [];
          this.diagnosticWaiters.set(
            opened.uri,
            waiters.filter((candidate) => candidate !== waiter),
          );
          resolve(this.diagnostics.get(opened.uri)?.diagnostics ?? []);
        }, DIAGNOSTIC_WAIT_MS),
      };
      const waiters = this.diagnosticWaiters.get(opened.uri) ?? [];
      waiters.push(waiter);
      this.diagnosticWaiters.set(opened.uri, waiters);
    });
  }

  private requiredConnection(): JsonRpcStdioConnection {
    if (!this.connection) {
      throw new ResearchError('language_unavailable');
    }
    return this.connection;
  }
}

class JsonRpcStdioConnection {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  public constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly onNotification: (message: JsonRpcMessage) => void,
    private readonly onClose: () => void,
  ) {
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (message: string) => {
      const detail = message.trim();
      if (detail) {
        console.error(`[jixie] Pyright: ${detail}`);
      }
    });
    child.on('error', (error) =>
      this.close(new ResearchError('language_unavailable', { cause: error })),
    );
    child.on('exit', (code, signal) =>
      this.close(
        new ResearchError('language_unavailable', {
          cause: new Error(`Pyright exited (${code ?? signal ?? 'unknown'}).`),
        }),
      ),
    );
  }

  public request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new ResearchError('language_unavailable'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ResearchError('language_unavailable', {
            cause: new Error(`Pyright request timed out: ${method}`),
          }),
        );
      }, LANGUAGE_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  public notify(method: string, params: unknown): void {
    if (!this.closed) {
      this.send({ jsonrpc: '2.0', method, params });
    }
  }

  public async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.request('shutdown', null).catch(() => undefined);
    this.notify('exit', null);
    this.child.kill();
    this.close(new Error('Pyright language server was stopped.'));
  }

  /**
   * 从子进程字节流解析 Content-Length 消息，保留不完整帧。
   *
   * Parse Content-Length messages from the child stream while retaining partial frames.
   */
  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.close(new Error('Pyright sent a JSON-RPC frame without Content-Length.'));
        return;
      }
      const length = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      if (this.buffer.length < messageStart + length) {
        return;
      }
      const payload = this.buffer.subarray(messageStart, messageStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(messageStart + length);
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(payload) as JsonRpcMessage;
      } catch {
        this.close(new Error('Pyright sent invalid JSON-RPC JSON.'));
        return;
      }
      this.receive(message);
    }
  }

  /**
   * 按 JSON-RPC 身份路由响应与通知，处理协议错误。
   *
   * Route JSON-RPC responses and notifications by identity and handle protocol errors.
   */
  private receive(message: JsonRpcMessage): void {
    if (message.method && message.id !== undefined) {
      this.handleServerRequest(message);
      return;
    }
    if (message.method) {
      this.onNotification(message);
      return;
    }
    if (message.id === undefined) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) {
      pending.reject(new JsonRpcResponseError(message.error.code, message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private handleServerRequest(message: JsonRpcMessage): void {
    let result: unknown = null;
    if (message.method === 'workspace/configuration' && isRecord(message.params)) {
      const items = Array.isArray(message.params.items) ? message.params.items : [];
      result = items.map(() => null);
    }
    this.send({ jsonrpc: '2.0', id: message.id, result });
  }

  private send(message: JsonRpcMessage): void {
    const payload = JSON.stringify(message);
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`,
    );
  }

  /**
   * 关闭指定语言文档并清理对应诊断与等待状态。
   *
   * Close a language document and clear its diagnostics and waiters.
   */
  private close(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.onClose();
  }
}

async function writeLanguageStub(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, 'utf8');
}

/**
 * 规范化补全列表及编辑范围，供 Cell 编辑器消费。
 *
 * Normalize completion items and edit ranges for cell editors.
 */
function normalizeCompletion(
  document: ResearchLanguageDocument,
  raw: unknown,
): ResearchLanguageCompletionItemV1[] {
  if (!isRecord(raw) || !stringValue(raw.label)) {
    return [];
  }
  const item: ResearchLanguageCompletionItemV1 = { label: stringValue(raw.label)! };
  const kind = numberValue(raw.kind);
  if (kind !== undefined) {
    item.kind = kind;
  }
  const detail = stringValue(raw.detail);
  if (detail) {
    item.detail = detail;
  }
  const documentation = documentationText(raw.documentation);
  if (documentation) {
    item.documentation = documentation;
  }
  const sortText = stringValue(raw.sortText);
  if (sortText) {
    item.sortText = sortText;
  }
  const filterText = stringValue(raw.filterText);
  if (filterText) {
    item.filterText = filterText;
  }
  const insertText = stringValue(raw.insertText);
  if (insertText) {
    item.insertText = insertText;
  }
  if (raw.insertTextFormat === 1 || raw.insertTextFormat === 2) {
    item.insertTextFormat = raw.insertTextFormat;
  }
  const textEdit = normalizeTextEdit(document, raw.textEdit);
  if (textEdit) {
    item.textEdit = textEdit;
  }
  if (Array.isArray(raw.additionalTextEdits)) {
    const edits = raw.additionalTextEdits.flatMap((edit) => {
      const normalized = normalizeTextEdit(document, edit);
      return normalized ? [normalized] : [];
    });
    if (edits.length > 0) {
      item.additionalTextEdits = edits;
    }
  }
  return [item];
}

/**
 * 将 LSP 文本编辑转换到公开编辑器契约，保留插入替换范围。
 *
 * Map LSP text edits into the public editor contract with insert and replace ranges.
 */
function normalizeTextEdit(
  document: ResearchLanguageDocument,
  raw: unknown,
): ResearchLanguageTextEditV1 | null {
  if (!isRecord(raw) || !stringValue(raw.newText)) {
    return null;
  }
  const range = asLspRange(raw.range) ?? asLspRange(raw.replace) ?? asLspRange(raw.insert);
  if (!range) {
    return null;
  }
  const mapped = researchVirtualRangeToCell(document, range);
  return mapped ? { ...mapped, newText: stringValue(raw.newText)! } : null;
}

/**
 * 规范化 hover 内容与范围，供编辑器展示。
 *
 * Normalize hover content and ranges for editor rendering.
 */
function normalizeHover(
  document: ResearchLanguageDocument,
  raw: unknown,
): ResearchLanguageHoverV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  const markdown = hoverText(raw.contents);
  if (!markdown) {
    return null;
  }
  const mappedRange = asLspRange(raw.range)
    ? researchVirtualRangeToCell(document, asLspRange(raw.range)!)?.range
    : undefined;
  return { markdown, ...(mappedRange ? { range: mappedRange } : {}) };
}

/**
 * 整理签名帮助和当前参数索引，供编辑器提示。
 *
 * Normalize signature help and active parameter indexes for the editor.
 */
function normalizeSignatureHelp(raw: unknown): ResearchLanguageSignatureHelpV1 | null {
  if (!isRecord(raw) || !Array.isArray(raw.signatures)) {
    return null;
  }

  /**
   * 过滤非法签名并规范化参数标签，供 Monaco 签名帮助。
   *
   * Filter invalid signatures and normalize parameter labels for Monaco signature help.
   */
  const signatures = raw.signatures.flatMap((signature) => {
    if (!isRecord(signature) || !stringValue(signature.label)) {
      return [];
    }
    const parameters = Array.isArray(signature.parameters)
      ? signature.parameters.flatMap((parameter) => {
          if (!isRecord(parameter)) {
            return [];
          }
          const label =
            stringValue(parameter.label) ??
            (Array.isArray(parameter.label) &&
            parameter.label.length === 2 &&
            typeof parameter.label[0] === 'number' &&
            typeof parameter.label[1] === 'number'
              ? ([parameter.label[0], parameter.label[1]] as [number, number])
              : null);
          if (label === null) {
            return [];
          }
          const documentation = documentationText(parameter.documentation);
          return [{ label, ...(documentation ? { documentation } : {}) }];
        })
      : [];
    const documentation = documentationText(signature.documentation);
    return [
      {
        label: stringValue(signature.label)!,
        ...(documentation ? { documentation } : {}),
        parameters,
      },
    ];
  });
  return {
    signatures,
    activeSignature: numberValue(raw.activeSignature) ?? 0,
    activeParameter: numberValue(raw.activeParameter) ?? 0,
  };
}

/**
 * 将语言服务位置映射为公开位置，供跳转定义使用。
 *
 * Map language-service locations into public navigation locations.
 */
function normalizeLocation(
  opened: OpenResearchLanguageDocument,
  raw: unknown,
): ResearchLanguageLocationV1[] {
  if (!isRecord(raw)) {
    return [];
  }
  const uri = stringValue(raw.uri) ?? stringValue(raw.targetUri);
  const range = asLspRange(raw.targetSelectionRange) ?? asLspRange(raw.range);
  if (uri !== opened.uri || !range) {
    return [];
  }
  const mapped = researchVirtualRangeToCell(opened.document, range);
  return mapped ? [mapped] : [];
}

/**
 * 规范化重命名预检查结果，保留合法范围和默认文本。
 *
 * Normalize rename preparation ranges and placeholder text.
 */
function normalizeRenamePreparation(
  document: ResearchLanguageDocument,
  raw: unknown,
): { range: ResearchLanguageRangeV1; placeholder?: string } | null {
  const range = asLspRange(raw) ?? (isRecord(raw) ? asLspRange(raw.range) : null);
  if (!range) {
    return null;
  }
  const mapped = researchVirtualRangeToCell(document, range);
  if (!mapped) {
    return null;
  }
  const placeholder = isRecord(raw) ? stringValue(raw.placeholder) : undefined;
  return { range: mapped.range, ...(placeholder ? { placeholder } : {}) };
}

/**
 * 规范化跨文档编辑集合，供重命名安全应用。
 *
 * Normalize workspace edit collections for safe rename application.
 */
function normalizeWorkspaceEdit(
  opened: OpenResearchLanguageDocument,
  raw: unknown,
): ResearchLanguageTextEditV1[] {
  if (!isRecord(raw)) {
    return [];
  }
  const edits: unknown[] = [];
  if (isRecord(raw.changes)) {
    const changedEdits = raw.changes[opened.uri];
    if (Array.isArray(changedEdits)) {
      edits.push(...changedEdits);
    }
  }
  if (Array.isArray(raw.documentChanges)) {
    for (const change of raw.documentChanges) {
      if (!isRecord(change) || !isRecord(change.textDocument)) {
        continue;
      }
      if (change.textDocument.uri === opened.uri && Array.isArray(change.edits)) {
        edits.push(...change.edits);
      }
    }
  }
  return edits.flatMap((edit) => {
    const normalized = normalizeTextEdit(opened.document, edit);
    return normalized ? [normalized] : [];
  });
}

/**
 * 规范化诊断严重度、范围和消息，供 Cell 标注。
 *
 * Normalize diagnostic severity, range and message for cell annotations.
 */
function normalizeDiagnostic(
  document: ResearchLanguageDocument,
  diagnostic: LspDiagnostic,
): ResearchLanguageDiagnosticV1[] {
  const mapped = researchVirtualRangeToCell(document, diagnostic.range);
  if (!mapped) {
    return [];
  }
  const severity =
    diagnostic.severity === 1 ||
    diagnostic.severity === 2 ||
    diagnostic.severity === 3 ||
    diagnostic.severity === 4
      ? diagnostic.severity
      : 3;
  return [
    {
      ...mapped,
      severity,
      message: diagnostic.message,
      ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
      ...(diagnostic.source ? { source: diagnostic.source } : {}),
    },
  ];
}

/**
 * 提取多种 hover 内容为可展示文本，保留代码与 Markdown。
 *
 * Extract displayable text from hover variants while preserving code and Markdown.
 */
function hoverText(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.map(hoverText).filter(Boolean).join('\n\n');
  }
  if (!isRecord(raw)) {
    return '';
  }
  const value = stringValue(raw.value);
  if (!value) {
    return '';
  }
  const language = stringValue(raw.language);
  return language ? `\`\`\`${language}\n${value}\n\`\`\`` : value;
}

function documentationText(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  if (isRecord(raw)) {
    return stringValue(raw.value);
  }
  return undefined;
}

function asLspRange(raw: unknown): LspRange | null {
  if (!isRecord(raw) || !isLspPosition(raw.start) || !isLspPosition(raw.end)) {
    return null;
  }
  return { start: raw.start, end: raw.end };
}

function isLspPosition(raw: unknown): raw is LspPosition {
  return (
    isRecord(raw) &&
    typeof raw.line === 'number' &&
    Number.isInteger(raw.line) &&
    typeof raw.character === 'number' &&
    Number.isInteger(raw.character)
  );
}

function isLspDiagnostic(raw: unknown): raw is LspDiagnostic {
  return isRecord(raw) && asLspRange(raw.range) !== null && typeof raw.message === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export const researchPythonLanguageService = new ResearchPythonLanguageService();
