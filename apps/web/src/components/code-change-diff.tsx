import '@src/components/monaco-setup';
import { DiffEditor } from '@monaco-editor/react';
import type { CodeChangeProposalV1 } from '@jixie/shared';

/**
 * 用只读差异展示不可变的生成基准与建议，编辑器不承担保存职责。
 *
 * Display immutable original and proposed code; the diff editor never saves changes.
 */
export default function CodeChangeDiff({ proposal }: { proposal: CodeChangeProposalV1 }) {
  const extension = proposal.language === 'python' ? 'py' : 'ts';
  const base = `file:///code-proposals/${encodeURIComponent(proposal.id)}`;

  return (
    <DiffEditor
      height="min(64vh, 640px)"
      original={proposal.beforeCode}
      modified={proposal.afterCode}
      originalLanguage={proposal.language}
      modifiedLanguage={proposal.language}
      originalModelPath={`${base}.before.${extension}`}
      modifiedModelPath={`${base}.after.${extension}`}
      options={{
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        fontSize: 13,
      }}
    />
  );
}
