import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppBindings, Env } from "./env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function jsonError(code: string, message: string, status = 400) {
  return Response.json(
    {
      success: false,
      error: { code, message }
    },
    { status }
  );
}

export function apiErrorResponse(error: Error) {
  if (error instanceof z.ZodError) {
    return jsonError("INVALID_REQUEST", "Request data does not match the expected format.", 400);
  }

  console.error("[api] unhandled error:", error);
  return jsonError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}

export function isDemoMode(env: Pick<Env, "DEMO_MODE">) {
  if (env.DEMO_MODE === true) return true;
  if (typeof env.DEMO_MODE !== "string") return false;
  return ["1", "true", "yes", "on"].includes(env.DEMO_MODE.trim().toLowerCase());
}

export const demoReadOnlyMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!isDemoMode(c.env) || SAFE_METHODS.has(c.req.method.toUpperCase())) {
    await next();
    return;
  }

  return c.json(
    {
      success: false as const,
      error: {
        code: "DEMO_MODE_READ_ONLY",
        message: "Demo site is read-only."
      }
    },
    403
  );
};

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export function parsePagination(query: Record<string, string | undefined>, defaultLimit = 50) {
  return paginationSchema.parse({
    limit: query.limit ?? defaultLimit,
    offset: query.offset ?? 0
  });
}

export function setPaginationHeaders(
  headers: (name: string, value: string) => void,
  input: { offset: number; limit: number; hasMore: boolean }
) {
  headers("X-Has-More", String(input.hasMore));
  if (input.hasMore) headers("X-Next-Offset", String(input.offset + input.limit));
}
