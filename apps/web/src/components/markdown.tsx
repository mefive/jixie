import { Fragment, type ReactNode } from 'react';
import './markdown.css';

/**
 * A minimal markdown renderer for short assistant replies — paragraphs, **bold**, `inline code`,
 * ```code fences```, - / 1. lists, and #/##/### headings. Rendered as React nodes (never
 * dangerouslySetInnerHTML), so the text is always escaped. Not a full CommonMark parser: it covers what
 * the strategy Agent actually emits, and unknown syntax falls through as plain text.
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
