import { CodeHighlighter } from '@ant-design/x';
import { XMarkdown, type ComponentProps } from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import { Children, type ReactNode } from 'react';
import './markdown.css';

interface MarkdownProps {
  text: string;
  streaming?: boolean;
}

const markdownConfig = { extensions: Latex() };
const markdownComponents = {
  code: MarkdownCode,
  pre: MarkdownPre,
};

/** Shared safe CommonMark/GFM renderer. Streaming mode caches incomplete syntax so incoming LLM
 * chunks do not repeatedly replace already-rendered DOM nodes. */
export function Markdown({ text, streaming = false }: MarkdownProps) {
  return (
    <XMarkdown
      className="jx-md"
      components={markdownComponents}
      content={text}
      config={markdownConfig}
      escapeRawHtml
      openLinksInNewTab
      streaming={{
        hasNextChunk: streaming,
        enableAnimation: false,
      }}
    />
  );
}

// —— Markdown renderers / helpers ——

function MarkdownCode({ block, children, className, lang }: ComponentProps) {
  if (!block) {
    return <code className={className}>{children}</code>;
  }

  const content = childrenText(children).replace(/\n$/, '');
  const language = normalizeCodeLanguage(lang);
  if (!language) {
    return (
      <pre className="jx-md-plainCode">
        <code>{content}</code>
      </pre>
    );
  }

  return (
    <CodeHighlighter
      classNames={{
        root: 'jx-md-codeBlock',
        header: 'jx-md-codeBlockHeader',
        headerTitle: 'jx-md-codeBlockLanguage',
        code: 'jx-md-codeBlockBody',
      }}
      lang={language}
      prismLightMode
    >
      {content}
    </CodeHighlighter>
  );
}

function MarkdownPre({ children }: ComponentProps) {
  return <>{children}</>;
}

function childrenText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');
}

function normalizeCodeLanguage(infoString?: string): string {
  const language = infoString?.trim().split(/\s+/)[0].toLocaleLowerCase() ?? '';
  const aliases: Record<string, string> = {
    js: 'javascript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    ts: 'typescript',
  };
  return aliases[language] ?? language;
}
