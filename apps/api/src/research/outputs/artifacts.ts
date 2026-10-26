import { createHash } from 'node:crypto';
import type { ResearchCellOutputBlockV1 } from '@jixie/shared';
import { ulid } from 'ulid';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PERSISTED_INLINE_RESEARCH_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * 提供二进制或结构化研究产物的创建字段。
 *
 * Supply fields for creating binary or structured research artifacts.
 */
export interface ResearchArtifactCreateInput {
  id: string;
  documentId: string;
  kind: 'image';
  mimeType: 'image/png' | 'image/svg+xml';
  data: Uint8Array<ArrayBuffer>;
  byteSize: number;
  sha256: string;
  width?: number;
  height?: number;
}

/**
 * 组合已物化产物与替换后的输出 JSON。
 *
 * Collect materialized artifacts and substituted output JSON.
 */
export interface MaterializedResearchOutputs {
  outputs: ResearchCellOutputBlockV1[];
  artifacts: ResearchArtifactCreateInput[];
}

/**
 * 在保存 Cell 输出 JSON 前提取二进制图片并物化为独立产物。
 *
 * Extract binary images before Cell output JSON is persisted.
 */
export function materializeResearchOutputArtifacts(
  outputs: ResearchCellOutputBlockV1[],
  documentId: string,
): MaterializedResearchOutputs {
  const artifacts: ResearchArtifactCreateInput[] = [];

  /**
   * 验证图片大小与元数据，物化为产物后替换输出中的二进制内容。
   *
   * Validate image sizes and metadata and replace binary output with persisted artifact references.
   */
  const persistedOutputs = outputs.map((output): ResearchCellOutputBlockV1 => {
    if (output.type !== 'image' || !output.dataUrl) {
      return output;
    }

    const data = decodeImageDataUrl(output.dataUrl, output.mimeType);
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `Python figure requires ${data.byteLength} bytes; the image limit is ${MAX_IMAGE_BYTES} bytes.`,
      );
    }
    if (output.byteSize !== undefined && output.byteSize !== data.byteLength) {
      throw new Error('Python figure byte size does not match its encoded image payload.');
    }

    const id = ulid();
    const sha256 = createHash('sha256').update(data).digest('hex');
    const dimensions = output.mimeType === 'image/png' ? pngDimensions(data) : undefined;
    artifacts.push({
      id,
      documentId,
      kind: 'image',
      mimeType: output.mimeType,
      data: Uint8Array.from(data),
      byteSize: data.byteLength,
      sha256,
      ...dimensions,
    });
    return {
      type: 'image',
      mimeType: output.mimeType,
      artifactId: id,
      byteSize: data.byteLength,
      sha256,
      ...dimensions,
      ...(output.alt ? { alt: output.alt } : {}),
    };
  });

  const inlineBytes = Buffer.byteLength(JSON.stringify(persistedOutputs), 'utf8');
  if (inlineBytes > MAX_PERSISTED_INLINE_RESEARCH_OUTPUT_BYTES) {
    throw new Error(
      `Research Cell inline outputs require ${inlineBytes} bytes; the persisted inline limit is ` +
        `${MAX_PERSISTED_INLINE_RESEARCH_OUTPUT_BYTES} bytes. Reduce the displayed value, table ` +
        'slice, or chart rows and rerun the Cell.',
    );
  }

  return { outputs: persistedOutputs, artifacts };
}

/**
 * 校验图片 data URL、MIME 与编码，再解码为产物字节。
 *
 * Validate an image data URL, MIME and encoding before decoding artifact bytes.
 */
function decodeImageDataUrl(
  dataUrl: string,
  expectedMimeType: 'image/png' | 'image/svg+xml',
): Buffer {
  const match = /^data:(image\/(?:png|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[1] !== expectedMimeType || match[2].length % 4 !== 0) {
    throw new Error('Python figure has an invalid image data URL.');
  }
  const data = Buffer.from(match[2], 'base64');
  if (data.toString('base64') !== match[2]) {
    throw new Error('Python figure has an invalid base64 payload.');
  }
  return data;
}

/**
 * 从 PNG 头读取并校验尺寸，供产物元数据一致性检查。
 *
 * Read validated PNG dimensions for artifact metadata checks.
 */
function pngDimensions(data: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    data.byteLength < 24 ||
    !data.subarray(0, signature.byteLength).equals(signature) ||
    data.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return undefined;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}
