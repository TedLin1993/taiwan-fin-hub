import type { ApiError } from "./types";

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value;
}

export function createApiClient(): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    const text = await response.text();
    let data: T | ApiError;
    try {
      data = JSON.parse(text) as T | ApiError;
    } catch {
      throw new Error(
        response.ok
          ? "伺服器回應格式錯誤。"
          : `伺服器暫時無法完成請求（HTTP ${response.status}）。`,
      );
    }
    if (!response.ok)
      throw new Error(isApiError(data) ? data.error.message : "請求失敗。");
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

export const queryKeys = {
  runtime: ["runtime"] as const,
  summary: ["summary"] as const,
  bank: ["bank"] as const,
  bills: ["creditCardBills"] as const,
  investments: ["investments"] as const,
  investmentTransactions: ["investment-transactions"] as const,
  invoices: ["invoices"] as const,
  invoiceTransactionMappings: ["invoice-transaction-mappings"] as const,
  manualAssets: ["manualAssets"] as const,
  exchangeRates: ["exchange-rates"] as const,
  netWorthHistory: ["netWorthHistory"] as const,
  syncJobs: ["sync-jobs"] as const,
  syncSchedule: ["sync-schedule"] as const,
  classificationCategories: ["classification-categories"] as const,
  classificationRules: ["classification-rules"] as const,
  connectorSettings: (id: string) => ["connector-settings", id] as const,
  manualAssetHistory: (id: string) => ["manualAssetHistory", id] as const,
};

export function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "請求失敗。";
}
