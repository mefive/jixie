import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';

// auth 相关路由统一错误形态：{ error: { code, message, details? } }
// - code:    机器可读，前端按它分发（toast / 高亮字段 / 跳转）
// - message: 人类可读，可直接展示
// - details: 可选附加信息（zod issues、字段名等）
export type ErrorCode =
  | 'VALIDATION_FAILED' // 入参形态错（zod 校验失败）/ 业务规则校验失败
  | 'NOT_FOUND' // URL 寻址的资源不存在
  | 'UNAUTHORIZED' // 未登录 / session 过期 / cookie 缺失
  | 'FORBIDDEN' // 已登录但无权（账号被禁用）
  | 'SERVICE_UNAVAILABLE'; // 上游依赖临时不可用（邮件服务等）

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

const STATUS_FOR: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SERVICE_UNAVAILABLE: 503,
};

export function apiError(c: Context, code: ErrorCode, message: string, details?: unknown) {
  const body: ApiErrorBody = {
    error: { code, message, ...(details !== undefined && { details }) },
  };
  return c.json(body, STATUS_FOR[code]);
}

// 包装 zValidator，把它默认的 { success:false, error:ZodError } 也压成 ApiErrorBody，
// 让路由里每种错误（zod / 业务）形态统一，前端只需认识一次。
export function validateJson<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', '入参不合法', { issues: result.error.issues });
    }
  });
}

export function validateQuery<T extends ZodSchema>(schema: T) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', '入参不合法', { issues: result.error.issues });
    }
  });
}

export function validateParam<T extends ZodSchema>(schema: T) {
  return zValidator('param', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', '入参不合法', { issues: result.error.issues });
    }
  });
}
