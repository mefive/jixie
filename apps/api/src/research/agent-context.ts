import { messageText, textMessage, type ChatMessage } from '@jixie/shared';

const MAX_RESEARCH_AGENT_CONTEXT_CELLS = 100;
const MAX_RESEARCH_AGENT_SOURCE_CHARACTERS = 48_000;
const MAX_RESEARCH_AGENT_RECENT_MESSAGES = 8;
const MAX_RESEARCH_AGENT_HISTORY_CHARACTERS = 20_000;
const MAX_RESEARCH_AGENT_GOAL_CHARACTERS = 2_000;
const MAX_RESEARCH_AGENT_CONFIRMED_CHOICES = 4;
const MAX_RESEARCH_AGENT_CHOICE_CHARACTERS = 1_000;
const MAX_RESEARCH_AGENT_RECENT_MESSAGE_CHARACTERS = 4_000;
const MAX_RESEARCH_AGENT_OUTPUT_CELLS = 5;
const MAX_RESEARCH_AGENT_OUTPUT_BLOCKS = 10;

interface ResearchAgentDocumentCell {
  id: string;
  position: number;
  kind: string;
  source: string;
  status: string;
  revision: number;
  definitions: unknown;
  references: unknown;
  output: unknown;
  lastExecutedRevision: number | null;
  lastExecutedAt: Date | null;
}

interface ResearchAgentDocument {
  id: string;
  updatedAt: Date;
  contentRevision: number;
  cells: ResearchAgentDocumentCell[];
}

/** Keep durable chat history intact while sending only bounded, decision-relevant text to the LLM. */
export function compactResearchAgentHistory(history: ChatMessage[]): ChatMessage[] {
  if (history.length === 0) {
    return [];
  }

  const recentStart = Math.max(0, history.length - MAX_RESEARCH_AGENT_RECENT_MESSAGES);
  const recentIndices = history.map((_, index) => index).slice(recentStart);
  const recentIndexSet = new Set(recentIndices);
  const goalIndex = history.findIndex(
    (message) => message.role === 'user' && messageText(message).length > 0,
  );
  const confirmedChoiceIndices = history
    .flatMap((message, index) =>
      message.parts.some(
        (part) =>
          part.type === 'research_clarification' && part.clarification.status === 'answered',
      )
        ? [index]
        : [],
    )
    .slice(-MAX_RESEARCH_AGENT_CONFIRMED_CHOICES)
    .filter((index) => !recentIndexSet.has(index) && index !== goalIndex);

  const selected = new Map<number, ChatMessage>();
  let pinnedCharacters = 0;
  if (goalIndex >= 0 && !recentIndexSet.has(goalIndex)) {
    const goal = boundedTextMessage(history[goalIndex], MAX_RESEARCH_AGENT_GOAL_CHARACTERS);
    selected.set(goalIndex, goal);
    pinnedCharacters += messageText(goal).length;
  }
  for (const index of confirmedChoiceIndices) {
    const choice = boundedTextMessage(history[index], MAX_RESEARCH_AGENT_CHOICE_CHARACTERS);
    selected.set(index, choice);
    pinnedCharacters += messageText(choice).length;
  }

  const recentBudget = Math.max(0, MAX_RESEARCH_AGENT_HISTORY_CHARACTERS - pinnedCharacters);
  const recentMessageCharacters = Math.min(
    MAX_RESEARCH_AGENT_RECENT_MESSAGE_CHARACTERS,
    Math.floor(recentBudget / Math.max(1, recentIndices.length)),
  );
  for (const index of recentIndices) {
    selected.set(index, boundedTextMessage(history[index], recentMessageCharacters));
  }

  return [...selected]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, message]) => message);
}

/** Build a bounded document snapshot and identify Cells whose complete source is safe to edit. */
export function researchAgentDocumentContext(document: ResearchAgentDocument): {
  context: string;
  editableCellIds: Set<string>;
} {
  let remainingSourceCharacters = MAX_RESEARCH_AGENT_SOURCE_CHARACTERS;
  const editableCellIds = new Set<string>();
  const contextCells = document.cells.slice(0, MAX_RESEARCH_AGENT_CONTEXT_CELLS);
  const latestOutputCellIds = new Set(
    contextCells
      .filter((cell) => cell.lastExecutedAt && Array.isArray(cell.output))
      .sort((left, right) => right.lastExecutedAt!.getTime() - left.lastExecutedAt!.getTime())
      .slice(0, MAX_RESEARCH_AGENT_OUTPUT_CELLS)
      .map((cell) => cell.id),
  );
  const includedCells = contextCells.map((cell) => {
    const sourceCharacters = Math.min(remainingSourceCharacters, cell.source.length);
    const source = cell.source.slice(0, sourceCharacters);
    const sourceTruncated = source.length !== cell.source.length;
    remainingSourceCharacters -= sourceCharacters;
    if (!sourceTruncated) {
      editableCellIds.add(cell.id);
    }

    const output = Array.isArray(cell.output) ? cell.output : [];
    return {
      id: cell.id,
      position: cell.position,
      kind: cell.kind,
      status: cell.status,
      revision: cell.revision,
      definitions: stringArray(cell.definitions),
      references: stringArray(cell.references),
      outputTypes: output.slice(0, 20).map(outputType),
      ...(latestOutputCellIds.has(cell.id)
        ? {
            latestOutputSummary: output
              .slice(0, MAX_RESEARCH_AGENT_OUTPUT_BLOCKS)
              .map(summarizeResearchOutput),
            outputsTruncated: output.length > MAX_RESEARCH_AGENT_OUTPUT_BLOCKS,
          }
        : {}),
      lastExecutedRevision: cell.lastExecutedRevision,
      lastExecutedAt: cell.lastExecutedAt?.toISOString() ?? null,
      source,
      sourceTruncated,
    };
  });

  return {
    context: JSON.stringify({
      version: 2,
      documentId: document.id,
      updatedAt: document.updatedAt.toISOString(),
      contentRevision: document.contentRevision,
      runtime: 'research-py-v1',
      cells: includedCells,
      cellsTruncated: document.cells.length > includedCells.length,
      outputSummaryCellLimit: MAX_RESEARCH_AGENT_OUTPUT_CELLS,
    }),
    editableCellIds,
  };
}

function boundedTextMessage(message: ChatMessage, limit: number): ChatMessage {
  return textMessage(message.role, clipText(messageText(message), limit));
}

function clipText(value: string, limit: number): string {
  const marker = '\n[truncated]';
  if (value.length <= limit) {
    return value;
  }
  if (limit <= marker.length) {
    return marker.slice(0, limit);
  }
  return `${value.slice(0, limit - marker.length)}${marker}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function outputType(output: unknown): string {
  return output && typeof output === 'object' && 'type' in output ? String(output.type) : 'unknown';
}

function summarizeResearchOutput(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== 'object') {
    return { type: 'unknown' };
  }

  const block = output as Record<string, unknown>;
  const type = typeof block.type === 'string' ? block.type : 'unknown';
  switch (type) {
    case 'text':
      return {
        type,
        ...(typeof block.level === 'string' ? { level: block.level } : {}),
        text: clipText(typeof block.text === 'string' ? block.text : '', 400),
      };
    case 'value':
      return {
        type,
        value: Array.isArray(block.value)
          ? block.value.slice(0, 20).map(compactScalar)
          : compactScalar(block.value),
        valueTruncated: Array.isArray(block.value) && block.value.length > 20,
      };
    case 'table':
      return {
        type,
        columns: stringArray(block.columns).slice(0, 20),
        rowCount: typeof block.rowCount === 'number' ? block.rowCount : null,
        truncated: block.truncated === true,
        truncatedColumns: block.truncatedColumns === true,
        truncatedCells: block.truncatedCells === true,
        truncatedBytes: block.truncatedBytes === true,
      };
    case 'chart':
      return {
        type,
        ...(typeof block.title === 'string' ? { title: clipText(block.title, 200) } : {}),
        ...(typeof block.kind === 'string' ? { kind: block.kind } : {}),
        ...(typeof block.x === 'string' ? { x: block.x } : {}),
        ...(typeof block.y === 'string' ? { y: block.y } : {}),
        seriesCount: Array.isArray(block.series) ? block.series.length : 0,
        rowCount: Array.isArray(block.rows) ? block.rows.length : 0,
      };
    case 'image':
      return {
        type,
        ...(typeof block.mimeType === 'string' ? { mimeType: block.mimeType } : {}),
        ...(typeof block.alt === 'string' ? { alt: clipText(block.alt, 200) } : {}),
        ...(typeof block.byteSize === 'number' ? { byteSize: block.byteSize } : {}),
        ...(typeof block.width === 'number' ? { width: block.width } : {}),
        ...(typeof block.height === 'number' ? { height: block.height } : {}),
      };
    default:
      return { type };
  }
}

function compactScalar(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') {
    return clipText(value, 200);
  }
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : null;
}
