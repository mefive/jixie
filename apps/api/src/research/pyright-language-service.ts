import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
import {
  buildResearchLanguageDocument,
  researchCellPositionToVirtual,
  researchVirtualRangeToCell,
  type ResearchLanguageDocument,
} from './research-language-document.js';
import { RESEARCH_LANGUAGE_LIBRARY_STUBS } from './research-language-stubs.js';

type JsonRpcId = number | string;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

interface OpenResearchLanguageDocument {
  uri: string;
  version: number;
  text: string;
  document: ResearchLanguageDocument;
  lastUsedAt: number;
}

interface PublishedDiagnostics {
  version: number;
  diagnostics: LspDiagnostic[];
}

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
      throw new Error('The requested Research Cell position is outside the virtual document.');
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
          throw new Error('A new symbol name is required for rename.');
        }
        return this.rename(opened, position, request.newName);
    }
  }

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
      throw new Error('Pyright language server is not initialized.');
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
    child.on('error', (error) => this.close(error));
    child.on('exit', (code, signal) =>
      this.close(new Error(`Pyright exited (${code ?? signal ?? 'unknown'}).`)),
    );
  }

  public request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('Pyright language server is closed.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pyright request timed out: ${method}`));
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

class JsonRpcResponseError extends Error {
  public constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'JsonRpcResponseError';
  }
}

async function writeLanguageStub(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, 'utf8');
}

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

function normalizeSignatureHelp(raw: unknown): ResearchLanguageSignatureHelpV1 | null {
  if (!isRecord(raw) || !Array.isArray(raw.signatures)) {
    return null;
  }
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
