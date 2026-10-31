import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";

/** 统一响应体：{ code, message, data }。code=0 成功；4xxx 客户端；5xxx 服务端 */
export type ApiBody<T> = { code: number; message: string; data: T | null };

export function ok<T>(data: T, message = "ok") {
  return NextResponse.json<ApiBody<T>>({ code: 0, message, data }, { status: 200 });
}

export function fail(code: number, message: string, status = 400) {
  return NextResponse.json<ApiBody<null>>({ code, message, data: null }, { status });
}

export const Errors = {
  unauthorized: () => fail(4001, "请先登录", 401),
  forbidden: () => fail(4003, "无权操作这条数据", 403),
  notFound: (what = "资源") => fail(4004, `${what}不存在`, 404),
  badRequest: (msg = "参数不合法") => fail(4000, msg, 400),
  tooMany: (msg = "请求过于频繁，请稍后再试") => fail(4029, msg, 429),
  server: (msg = "服务器开小差了，请稍后再试") => fail(5000, msg, 500),
};

/** 解析并校验请求体；失败直接抛 ApiError，交给 withApi 统一兜底 */
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function withApi<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.code, error.message, error.status);
      if (error instanceof ZodError) {
        const first = error.issues[0];
        return fail(4000, first ? `参数不合法：${first.path.join(".")} ${first.message}` : "参数不合法", 400);
      }
      console.error("[api]", error);
      return Errors.server();
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (!text.trim()) throw new ApiError(4000, "请求体不能为空");
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(4000, "请求体不是合法 JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(4000, first ? `参数不合法：${first.path.join(".")} ${first.message}` : "参数不合法");
  }
  return parsed.data;
}
