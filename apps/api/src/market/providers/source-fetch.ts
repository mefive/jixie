import { MarketSourceDownloadError } from '../errors.js';

/** 只包装网络请求失败，响应解析和业务映射保留自己的错误。 / Wrap request failures only; parsing and mapping keep their own errors. */
export async function fetchMarketSource(
  fetcher: typeof fetch,
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  return sourceTransport(() => fetcher(...args));
}

/** 读取完整文本后再由调用方解析，区分传输中断和格式错误。 / Read complete text before caller-side parsing to distinguish transport and format failures. */
export function readMarketSourceText(response: Response): Promise<string> {
  return sourceTransport(() => response.text());
}

/** 二进制响应传输中断保留下载身份，工作簿解析在调用方进行。 / Preserve binary transport failure identity; callers parse the workbook separately. */
export function readMarketSourceBytes(response: Response): Promise<ArrayBuffer> {
  return sourceTransport(() => response.arrayBuffer());
}

async function sourceTransport<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw new MarketSourceDownloadError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}
