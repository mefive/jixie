import { XMarkdown } from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import './markdown.css';

interface MarkdownProps {
  text: string;
  streaming?: boolean;
}

const markdownConfig = { extensions: Latex() };

/** Shared safe CommonMark/GFM renderer. Streaming mode caches incomplete syntax so incoming LLM
 * chunks do not repeatedly replace already-rendered DOM nodes. */
export function Markdown({ text, streaming = false }: MarkdownProps) {
  return (
    <XMarkdown
      className="jx-md"
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
