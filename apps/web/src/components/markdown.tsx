import { Fragment, type ReactNode } from 'react';
import './markdown.css';

/**
 * A minimal markdown renderer for short assistant replies — paragraphs, **bold**, `inline code`,
 * ```code fences```, - / 1. lists, #/##/### headings, and GFM |tables|. Rendered as React nodes
 * (never dangerouslySetInnerHTML), so the text is always escaped. Not a full CommonMark parser: it
 * covers what the Agent actually emits, and unknown syntax falls through as plain text.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="jx-md">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    // fenced code block
    if (/^```/.test(line.trim())) {
      const buffer: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        buffer.push(lines[index]);
        index++;
      }
      index++; // skip the closing fence
      blocks.push(
        <pre key={key++} className="jx-md-pre">
          <code>{buffer.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // blank line — paragraph separator
    if (line.trim() === '') {
      index++;
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      blocks.push(
        <div key={key++} className={`jx-md-h jx-md-h${heading[1].length}`}>
          {renderInline(heading[2])}
        </div>,
      );
      index++;
      continue;
    }

    // GFM table — a |…| row followed by the |---|---| separator line
    if (isTableStart(lines, index)) {
      const header = parseTableRow(lines[index]);
      index += 2; // skip the header and the separator
      const rows: string[][] = [];
      while (index < lines.length && isTableLine(lines[index])) {
        rows.push(parseTableRow(lines[index]));
        index++;
      }
      blocks.push(
        <div key={key++} className="jx-md-tableWrap">
          <table className="jx-md-table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // list (consecutive - / * / 1. lines)
    if (isListLine(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (index < lines.length && isListLine(lines[index])) {
        const content = lines[index].replace(/^\s*([-*]|\d+\.)\s+/, '');
        items.push(<li key={items.length}>{renderInline(content)}</li>);
        index++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="jx-md-list">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="jx-md-list">
            {items}
          </ul>
        ),
      );
      continue;
    }

    // paragraph — gather until a blank line / block boundary
    const buffer: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^```/.test(lines[index].trim()) &&
      !isListLine(lines[index]) &&
      !isTableStart(lines, index) &&
      !/^#{1,3}\s/.test(lines[index])
    ) {
      buffer.push(lines[index]);
      index++;
    }
    blocks.push(
      <p key={key++} className="jx-md-p">
        {renderInline(buffer.join('\n'))}
      </p>,
    );
  }

  return blocks;
}

function isListLine(line: string): boolean {
  return /^\s*([-*]|\d+\.)\s+/.test(line);
}

function isTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

/** A table starts only when a |…| row is immediately followed by the |---|:---| separator —
 * a lone piped line stays a paragraph (so the paragraph gatherer can't loop on it). */
function isTableStart(lines: string[], index: number): boolean {
  return (
    isTableLine(lines[index]) &&
    index + 1 < lines.length &&
    /^\s*\|?[\s|:-]+\|?\s*$/.test(lines[index + 1]) &&
    lines[index + 1].includes('-')
  );
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Inline spans: **bold** and `code`; everything else is plain text. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(<Fragment key={key++}>{text.slice(last, match.index)}</Fragment>);
    }
    if (match[2] != null) {
      nodes.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3] != null) {
      nodes.push(
        <code key={key++} className="jx-md-code">
          {match[3]}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  }
  return nodes;
}
