import type { ResearchCellOutputBlockV1, ResearchExecutionV1 } from '@jixie/shared';

const MAX_RESEARCH_CONTEXT_CHARACTERS = 32_000;
const MAX_CELL_SOURCE_CHARACTERS = 8_000;
const MAX_OUTPUT_CHARACTERS = 3_000;

/** Build a bounded, image-byte-free view of one immutable execution for an LLM handoff gate. */
export function researchHandoffContext(execution: ResearchExecutionV1): string {
  const sections = [
    JSON.stringify({
      executionId: execution.id,
      title: execution.title,
      displayName: execution.displayName,
      tags: execution.tags,
      userNote: execution.userNote,
      contentRevision: execution.contentRevision,
      sourceHash: execution.sourceHash,
    }),
  ];
  for (const cell of execution.cells) {
    const source = clipResearchHandoffText(cell.source, MAX_CELL_SOURCE_CHARACTERS);
    const outputs = clipResearchHandoffText(
      JSON.stringify(cell.outputs.map(researchOutputPreview)),
      MAX_OUTPUT_CHARACTERS,
    );
    sections.push(
      `CELL ${cell.position + 1} (${cell.kind}, ${cell.status})\nSOURCE:\n${source}\nOUTPUT PREVIEW:\n${outputs}`,
    );
  }
  return clipResearchHandoffText(sections.join('\n\n'), MAX_RESEARCH_CONTEXT_CHARACTERS);
}

function researchOutputPreview(output: ResearchCellOutputBlockV1): unknown {
  switch (output.type) {
    case 'text':
      return { ...output, text: clipResearchHandoffText(output.text, 1_000) };
    case 'value':
      return output;
    case 'table':
      return {
        type: output.type,
        columns: output.columns,
        rows: output.rows.slice(0, 5),
        rowCount: output.rowCount,
        truncated: output.truncated,
      };
    case 'chart':
      return {
        type: output.type,
        title: output.title,
        kind: output.kind,
        x: output.x,
        y: output.y,
        series: output.series,
        rows: output.rows.slice(0, 5),
      };
    case 'image':
      return {
        type: output.type,
        mimeType: output.mimeType,
        alt: output.alt,
        byteSize: output.byteSize,
        width: output.width,
        height: output.height,
      };
  }
}

function clipResearchHandoffText(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : `${value.slice(0, maxCharacters)}\n…[truncated]`;
}
