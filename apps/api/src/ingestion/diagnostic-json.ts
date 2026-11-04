const credentialField = /token|password|authorization|secret|api.?key|cookie|credential/i;

/**
 * 诊断文件只移除凭证；其他来源值、空值和零保持可区分。
 *
 * Remove credentials from diagnostic files while preserving source values, nulls and zeros.
 */
export function diagnosticJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (credentialField.test(key)) {
        return '[redacted]';
      }
      if (typeof item === 'bigint') {
        return item.toString();
      }
      if (typeof item === 'string') {
        let text = item.replace(
          /([?&](?:token|password|authorization|secret|api[_-]?key)=)[^&\s]+/gi,
          '$1[redacted]',
        );
        const trimmed = text.trimStart();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            const nested: unknown = JSON.parse(text);
            text = JSON.stringify(diagnosticJson(nested));
          } catch {
            // 非 JSON 的来源文本保留原意。 / Preserve non-JSON source text.
          }
        }

        return text;
      }

      return item;
    }),
  );
}
