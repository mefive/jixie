/**
 * 描述留存输入的业务方法与参数，不依赖沙盒帧。
 *
 * Describe retained input methods and arguments independently of sandbox frames.
 */
export interface ResearchInputRequest {
  method: string;
  arguments: unknown;
}

/**
 * 保存精确数据响应与公开元数据，供证据回放。
 *
 * Retain exact dataset responses and public metadata for replay.
 */
export type ResearchInputResponse = { result: Record<string, unknown> } | { error: string };
