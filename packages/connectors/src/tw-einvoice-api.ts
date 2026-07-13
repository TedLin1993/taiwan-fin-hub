const BASE_URL = "https://api.einvoice.nat.gov.tw";
const BARCODE_PATH = "/PB2CAPIVAN/Carrier/AppGetBarcode";
const INVOICE_PATH = "/PB2CAPIVAN/invServ/InvServ";
const MOBILE_BARCODE_TYPE = "3J0002";
const SUCCESS_CODE = "200";
const MORE_RESULTS_CODE = "996";

export type EInvoiceUser = {
  mobile?: string;
  mobileBarcode?: string;
  [key: string]: unknown;
};

export type LoginParams = {
  mobile: string;
  password: string;
  deviceId?: string;
};

type CarrierInvoiceParams = {
  carrierId?: string;
  carrierType?: string;
  cardEncrypt?: string;
  startDate?: string;
  endDate?: string;
};

type CarrierInvoiceDetailParams = {
  carrierId?: string;
  carrierType?: string;
  cardEncrypt?: string;
  invNum?: string;
  invDate?: string;
};

type ApiResponse = Record<string, unknown> & {
  code?: string | number;
  msg?: string;
  details?: unknown;
};

export class EInvoiceClient {
  currentUser: EInvoiceUser | null;
  host: string;
  private appId?: string;
  private deviceId: string;

  constructor({
    appId,
    apiKey,
    currentUser,
    deviceId,
    host
  }: {
    appId?: string;
    /** @deprecated Kept as a migration fallback for configs that stored the AppID as apiKey. */
    apiKey?: string;
    currentUser?: EInvoiceUser | null;
    deviceId?: string;
    host?: string;
  } = {}) {
    this.host = (host ?? BASE_URL).replace(/\/$/, "");
    this.appId = appId?.trim() || apiKey?.trim() || undefined;
    this.currentUser = currentUser ?? null;
    this.deviceId = deviceId?.trim() || createDeviceId();
  }

  async login(params: LoginParams) {
    const appId = this.requireAppId();
    const data = await this.post(BARCODE_PATH, {
      version: "2.0",
      action: "getBarcode",
      appID: appId,
      phoneNo: params.mobile,
      timeStamp: unixTimestamp(10),
      uuid: params.deviceId?.trim() || this.deviceId,
      verificationCode: params.password
    });
    assertSuccessful(data, "取得手機條碼");

    const mobileBarcode = readString(data.cardNo);
    if (!mobileBarcode) {
      throw new Error("電子發票 API 未回傳手機條碼，請確認手機號碼與驗證碼。");
    }

    this.currentUser = { mobile: params.mobile, mobileBarcode };
    return data;
  }

  async checkCarrierInvoices(params: CarrierInvoiceParams) {
    const carrierId = requiredParam(params.carrierId, "手機條碼");
    const cardEncrypt = requiredParam(params.cardEncrypt, "手機條碼驗證碼");
    const startDate = requiredParam(params.startDate, "查詢起日");
    const endDate = requiredParam(params.endDate, "查詢迄日");
    const rows: Record<string, unknown>[] = [];

    for (let page = 1; page <= 100; page += 1) {
      const data = await this.post(INVOICE_PATH, {
        version: "0.6",
        action: "carrierInvChk",
        appID: this.requireAppId(),
        cardType: params.carrierType || MOBILE_BARCODE_TYPE,
        cardNo: carrierId,
        cardEncrypt,
        startDate,
        endDate,
        onlyWinningInv: "N",
        timeStamp: unixTimestamp(10),
        expTimeStamp: unixTimestamp(180),
        uuid: this.deviceId,
        page: String(page)
      });
      const code = responseCode(data);
      if (code !== SUCCESS_CODE && code !== MORE_RESULTS_CODE) {
        throw apiError(data, "查詢發票");
      }

      const pageRows = arrayOfRecords(data.details).map(normalizeInvoiceHeader);
      rows.push(...pageRows);
      if (code !== MORE_RESULTS_CODE || pageRows.length === 0) break;
    }

    return { result: dedupeByInvoiceNumber(rows) };
  }

  async checkCarrierInvoiceDetail(params: CarrierInvoiceDetailParams) {
    const data = await this.post(INVOICE_PATH, {
      version: "0.5",
      action: "carrierInvDetail",
      appID: this.requireAppId(),
      cardType: params.carrierType || MOBILE_BARCODE_TYPE,
      cardNo: requiredParam(params.carrierId, "手機條碼"),
      cardEncrypt: requiredParam(params.cardEncrypt, "手機條碼驗證碼"),
      invNum: requiredParam(params.invNum, "發票號碼"),
      invDate: officialInvoiceDate(requiredParam(params.invDate, "發票日期")),
      timeStamp: unixTimestamp(10),
      expTimeStamp: unixTimestamp(180),
      uuid: this.deviceId
    });
    assertSuccessful(data, "查詢發票明細");
    return { result: data };
  }

  private async post(path: string, fields: Record<string, string>) {
    const res = await fetch(this.host + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams(fields).toString()
    });
    const text = await res.text();
    let data: ApiResponse;

    try {
      data = JSON.parse(text) as ApiResponse;
    } catch {
      throw new Error(`電子發票 API 回傳格式錯誤（HTTP ${res.status}）。`);
    }

    if (!res.ok) {
      throw new Error(`電子發票 API HTTP ${res.status}${data.msg ? `：${data.msg}` : ""}`);
    }
    return data;
  }

  private requireAppId() {
    if (!this.appId) {
      throw new Error("尚未設定財政部電子發票 AppID，請先在連接器設定中填寫 AppID。");
    }
    return this.appId;
  }
}

function unixTimestamp(secondsFromNow: number) {
  return String(Math.floor(Date.now() / 1000) + secondsFromNow);
}

function createDeviceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `taiwan-fin-hub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function responseCode(data: ApiResponse) {
  return data.code === undefined ? "" : String(data.code);
}

function assertSuccessful(data: ApiResponse, operation: string) {
  if (responseCode(data) !== SUCCESS_CODE) throw apiError(data, operation);
}

function apiError(data: ApiResponse, operation: string) {
  const code = responseCode(data) || "未知代碼";
  const message = readString(data.msg) || "未知錯誤";
  return new Error(`電子發票 API ${code}（${operation}）：${message}`);
}

function requiredParam(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少${label}。`);
  return normalized;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function normalizeInvoiceHeader(row: Record<string, unknown>) {
  return { ...row, invDate: normalizeOfficialDate(row.invDate) };
}

function normalizeOfficialDate(value: unknown) {
  if (typeof value === "string") return readableInvoiceDate(value);
  if (typeof value === "number") return formatLocalDate(new Date(value));
  if (!value || typeof value !== "object") return "";

  const date = value as Record<string, unknown>;
  const timestamp = Number(date.time);
  if (Number.isFinite(timestamp) && timestamp > 0) return formatLocalDate(new Date(timestamp));

  const rawYear = Number(date.year);
  const rawMonth = Number(date.month);
  const rawDay = Number(date.date ?? date.dayOfMonth);
  if ([rawYear, rawMonth, rawDay].every(Number.isFinite)) {
    // The API serializes java.util.Date fields: year is years since 1900 and month is zero-based.
    const year = rawYear < 300 ? rawYear + 1900 : rawYear;
    const month = rawMonth >= 0 && rawMonth <= 11 ? rawMonth + 1 : rawMonth;
    return `${year}/${String(month).padStart(2, "0")}/${String(rawDay).padStart(2, "0")}`;
  }
  return "";
}

function formatLocalDate(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function officialInvoiceDate(value: string) {
  return readableInvoiceDate(value).replace(/[-.]/g, "/").slice(0, 10);
}

function readableInvoiceDate(value: string) {
  const normalized = value.trim();
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}/${normalized.slice(4, 6)}/${normalized.slice(6, 8)}`;
  }
  return normalized;
}

function dedupeByInvoiceNumber(rows: Record<string, unknown>[]) {
  const unique = new Map<string, Record<string, unknown>>();
  rows.forEach((row, index) => {
    const key = `${readString(row.invNum)}:${readString(row.invDate)}` || String(index);
    unique.set(key, row);
  });
  return Array.from(unique.values());
}
