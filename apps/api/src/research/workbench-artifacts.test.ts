import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  materializeResearchOutputArtifacts,
  MAX_PERSISTED_INLINE_RESEARCH_OUTPUT_BYTES,
} from './workbench-artifacts.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XxR9WQAAAABJRU5ErkJggg==';

describe('Research workbench artifacts', () => {
  it('extracts an inline PNG into an immutable artifact reference', () => {
    const data = Buffer.from(PNG_BASE64, 'base64');
    const result = materializeResearchOutputArtifacts(
      [
        {
          type: 'image',
          mimeType: 'image/png',
          dataUrl: `data:image/png;base64,${PNG_BASE64}`,
          byteSize: data.byteLength,
          alt: 'One pixel',
        },
      ],
      'document-1',
      'execution-1',
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      documentId: 'document-1',
      executionId: 'execution-1',
      kind: 'image',
      mimeType: 'image/png',
      byteSize: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex'),
      width: 1,
      height: 1,
    });
    expect(Buffer.from(result.artifacts[0]?.data ?? []).equals(data)).toBe(true);
    expect(result.outputs[0]).toMatchObject({
      type: 'image',
      artifactId: result.artifacts[0]?.id,
      byteSize: data.byteLength,
      width: 1,
      height: 1,
      alt: 'One pixel',
    });
    expect(result.outputs[0]).not.toHaveProperty('dataUrl');
  });

  it('keeps legacy references readable without creating another artifact', () => {
    const output = {
      type: 'image' as const,
      mimeType: 'image/png' as const,
      artifactId: 'artifact-1',
      byteSize: 42,
    };
    const result = materializeResearchOutputArtifacts([output], 'document-1', 'execution-1');

    expect(result.outputs).toEqual([output]);
    expect(result.artifacts).toEqual([]);
  });

  it('rejects invalid images and oversized inline JSON', () => {
    expect(() =>
      materializeResearchOutputArtifacts(
        [
          {
            type: 'image',
            mimeType: 'image/png',
            dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
          },
        ],
        'document-1',
        'execution-1',
      ),
    ).toThrow('invalid image data URL');

    expect(() =>
      materializeResearchOutputArtifacts(
        [
          {
            type: 'text',
            text: 'x'.repeat(MAX_PERSISTED_INLINE_RESEARCH_OUTPUT_BYTES),
          },
        ],
        'document-1',
        'execution-1',
      ),
    ).toThrow('persisted inline limit');
  });
});
