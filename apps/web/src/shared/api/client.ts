import type { ApiErrorResponse } from "@taiwan-fin-hub/core";

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

function isApiError(value: unknown): value is ApiErrorResponse {
  return typeof value === "object" && value !== null && "error" in value;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function createApiClient(): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}) {
    const headers =
      init.body === undefined
        ? init.headers
        : { "Content-Type": "application/json", ...init.headers };
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let data: T | ApiErrorResponse;
    try {
      data = JSON.parse(text) as T | ApiErrorResponse;
    } catch {
      throw new Error(
        response.ok
          ? "伺服器回應格式錯誤。"
          : `伺服器暫時無法完成請求（HTTP ${response.status}）。`,
      );
    }
    if (!response.ok) {
      const error = isApiError(data)
        ? data.error
        : { code: "REQUEST_FAILED", message: "請求失敗。" };
      throw new ApiRequestError(error.code, error.message, response.status);
    }
    return data as T;
  }

  return {
    get: (path) => request(path),
    post: (path, body) =>
      request(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    put: (path, body) =>
      request(path, { method: "PUT", body: JSON.stringify(body) }),
    patch: (path, body) =>
      request(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (path) => request(path, { method: "DELETE" }),
  };
}

export function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "請求失敗。";
}
