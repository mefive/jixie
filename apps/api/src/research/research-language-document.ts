import type {
  ResearchLanguageCellV1,
  ResearchLanguagePositionV1,
  ResearchLanguageRangeV1,
} from '@jixie/shared';

const VIRTUAL_PRELUDE = [
  '# Generated Research document prelude. It is not persisted or executed.',
  'from jixie_research_sdk import charts, data',
  'import pandas as pd',
  'import numpy as np',
  '',
] as const;

export interface ResearchLanguageDocumentSegment {
  cellId: string;
  virtualStartLine: number;
  virtualEndLine: number;
  sourceLines: string[];
}

export interface ResearchLanguageDocument {
  text: string;
  segments: ResearchLanguageDocumentSegment[];
}

/** Build the single Python module Pyright sees from the ordered Python cells in a document. */
export function buildResearchLanguageDocument(
  cells: readonly ResearchLanguageCellV1[],
): ResearchLanguageDocument {
  const lines: string[] = [...VIRTUAL_PRELUDE];
  const segments: ResearchLanguageDocumentSegment[] = [];
  for (const cell of cells) {
    lines.push(`# %% Research Cell ${cell.id}`);
    const virtualStartLine = lines.length;
    const sourceLines = cell.source.split('\n');
    lines.push(...sourceLines);
    segments.push({
      cellId: cell.id,
      virtualStartLine,
      virtualEndLine: virtualStartLine + sourceLines.length,
      sourceLines,
    });
    lines.push('');
  }
  return { text: lines.join('\n'), segments };
}

export function researchCellPositionToVirtual(
  document: ResearchLanguageDocument,
  cellId: string,
  position: ResearchLanguagePositionV1,
): ResearchLanguagePositionV1 | null {
  const segment = document.segments.find((candidate) => candidate.cellId === cellId);
  if (!segment || position.line < 0 || position.line >= segment.sourceLines.length) {
    return null;
  }
  const line = segment.sourceLines[position.line];
  return {
    line: segment.virtualStartLine + position.line,
    character: Math.max(0, Math.min(position.character, line.length)),
  };
}

export function researchVirtualRangeToCell(
  document: ResearchLanguageDocument,
  range: ResearchLanguageRangeV1,
): { cellId: string; range: ResearchLanguageRangeV1 } | null {
  const segment = document.segments.find(
    (candidate) =>
      containsVirtualPosition(candidate, range.start) &&
      containsVirtualRangeEnd(candidate, range.end),
  );
  if (!segment) {
    return null;
  }
  return {
    cellId: segment.cellId,
    range: {
      start: toCellPosition(segment, range.start),
      end: toCellRangeEnd(segment, range.end),
    },
  };
}

function containsVirtualPosition(
  segment: ResearchLanguageDocumentSegment,
  position: ResearchLanguagePositionV1,
): boolean {
  return position.line >= segment.virtualStartLine && position.line < segment.virtualEndLine;
}

function containsVirtualRangeEnd(
  segment: ResearchLanguageDocumentSegment,
  position: ResearchLanguagePositionV1,
): boolean {
  return (
    containsVirtualPosition(segment, position) ||
    (position.line === segment.virtualEndLine && position.character === 0)
  );
}

function toCellPosition(
  segment: ResearchLanguageDocumentSegment,
  position: ResearchLanguagePositionV1,
): ResearchLanguagePositionV1 {
  const line = position.line - segment.virtualStartLine;
  return {
    line,
    character: Math.max(0, Math.min(position.character, segment.sourceLines[line]?.length ?? 0)),
  };
}

function toCellRangeEnd(
  segment: ResearchLanguageDocumentSegment,
  position: ResearchLanguagePositionV1,
): ResearchLanguagePositionV1 {
  if (position.line < segment.virtualEndLine) {
    return toCellPosition(segment, position);
  }
  const line = segment.sourceLines.length - 1;
  return { line, character: segment.sourceLines[line].length };
}
