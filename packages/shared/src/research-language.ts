import type { z } from 'zod';
import type { pythonLanguageRequestSchema } from './api/research.js';
/**
 * 采用零基行列位置，供 Research Python 语言服务通信。
 *
 * Zero-based source position used by the Research Python language service.
 */
export interface ResearchLanguagePositionV1 {
  line: number;
  character: number;
}

/**
 * 定义公开源码范围，供编辑、hover 和诊断共用。
 *
 * Describe source ranges shared by edits, hover and diagnostics.
 */
export interface ResearchLanguageRangeV1 {
  start: ResearchLanguagePositionV1;
  end: ResearchLanguagePositionV1;
}

/**
 * 提供 Cell 源码与身份，供合成文档语言分析。
 *
 * Supply cell identity and source for synthesized language analysis.
 */
export interface ResearchLanguageCellV1 {
  id: string;
  source: string;
}

export type ResearchLanguageActionV1 =
  | 'completion'
  | 'hover'
  | 'signature_help'
  | 'definition'
  | 'references'
  | 'prepare_rename'
  | 'rename'
  | 'diagnostics';

export type ResearchLanguageRequestV1 = z.input<typeof pythonLanguageRequestSchema>;

/**
 * 描述文本替换与范围，供语言服务编辑映射。
 *
 * Describe text replacement and ranges for language-service edits.
 */
export interface ResearchLanguageTextEditV1 {
  cellId: string;
  range: ResearchLanguageRangeV1;
  newText: string;
}

/**
 * 封装补全标签、类型和编辑内容，供 Monaco 适配。
 *
 * Describe completion labels, kinds and edits for Monaco adaptation.
 */
export interface ResearchLanguageCompletionItemV1 {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: 1 | 2;
  textEdit?: ResearchLanguageTextEditV1;
  additionalTextEdits?: ResearchLanguageTextEditV1[];
}

/**
 * 返回补全项及不完整状态，供后续请求。
 *
 * Return completion items and completeness state for follow-up requests.
 */
export interface ResearchLanguageCompletionResultV1 {
  items: ResearchLanguageCompletionItemV1[];
  incomplete: boolean;
}

/**
 * 保存 hover 说明及源码范围，供编辑器显示。
 *
 * Describe hover guidance and its source range.
 */
export interface ResearchLanguageHoverV1 {
  markdown: string;
  range?: ResearchLanguageRangeV1;
}

/**
 * 描述签名中的参数标签与说明，供当前参数提示。
 *
 * Describe signature parameter labels and guidance.
 */
export interface ResearchLanguageSignatureParameterV1 {
  label: string | [number, number];
  documentation?: string;
}

/**
 * 组合方法签名、参数及文档，供签名帮助。
 *
 * Describe a method signature, parameters and documentation.
 */
export interface ResearchLanguageSignatureV1 {
  label: string;
  documentation?: string;
  parameters: ResearchLanguageSignatureParameterV1[];
}

/**
 * 返回候选签名和当前参数索引，供编辑器提示。
 *
 * Return candidate signatures and active parameter indexes.
 */
export interface ResearchLanguageSignatureHelpV1 {
  signatures: ResearchLanguageSignatureV1[];
  activeSignature: number;
  activeParameter: number;
}

/**
 * 定位文档及源码范围，供定义跳转。
 *
 * Identify a document and source range for navigation.
 */
export interface ResearchLanguageLocationV1 {
  cellId: string;
  range: ResearchLanguageRangeV1;
}

/**
 * 返回可重命名范围和默认文本，供编辑前确认。
 *
 * Describe renameable ranges and placeholder text.
 */
export interface ResearchLanguageRenamePreparationV1 {
  range: ResearchLanguageRangeV1;
  placeholder?: string;
}

/**
 * 统一诊断级别、消息与位置，供 Cell 标记。
 *
 * Describe diagnostic severity, message and location for cell markers.
 */
export interface ResearchLanguageDiagnosticV1 {
  cellId: string;
  range: ResearchLanguageRangeV1;
  severity: 1 | 2 | 3 | 4;
  message: string;
  code?: string | number;
  source?: string;
}

/**
 * 区分各语言动作的响应，供前端安全分派。
 *
 * Discriminate language-action results for client dispatch.
 */
export type ResearchLanguageResultV1 =
  | { version: 1; action: 'completion'; result: ResearchLanguageCompletionResultV1 }
  | { version: 1; action: 'hover'; result: ResearchLanguageHoverV1 | null }
  | { version: 1; action: 'signature_help'; result: ResearchLanguageSignatureHelpV1 | null }
  | { version: 1; action: 'definition'; result: ResearchLanguageLocationV1[] }
  | { version: 1; action: 'references'; result: ResearchLanguageLocationV1[] }
  | {
      version: 1;
      action: 'prepare_rename';
      result: ResearchLanguageRenamePreparationV1 | null;
    }
  | { version: 1; action: 'rename'; result: ResearchLanguageTextEditV1[] }
  | { version: 1; action: 'diagnostics'; result: ResearchLanguageDiagnosticV1[] };
