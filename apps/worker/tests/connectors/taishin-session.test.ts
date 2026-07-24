import { beforeEach, describe, expect, it, vi } from "vitest";

const puppeteerMock = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  limits: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock("@cloudflare/puppeteer", () => ({ default: puppeteerMock }));

import {
  createTaishinConnector,
  prepareTaishinCaptcha,
  TaishinBrowserCapacityError,
  TaishinCredentialRejectedError,
} from "../../src/connectors/taishin";

const credentials = {
  userId: "A123456789",
  account: "test-user",
  password: "test-password",
  lookbackMonths: 6,
};

const selectors = {
  userId: 'input[data-taishin-field="user-id"]',
  account: 'input[data-taishin-field="account"]',
  password: 'input[data-taishin-field="password"]',
  captcha: 'input[data-taishin-field="captcha"]',
};

const captchaTarget = {
  selector: 'img[data-taishin-captcha="image"]',
  digitCount: 6,
};

function page() {
  return {
    $: vi.fn().mockResolvedValue({
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
    click: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    cookies: vi
      .fn()
      .mockResolvedValue([
        { name: "SESSION", value: "fresh", domain: "my.taishinbank.com.tw" },
      ]),
    setCookie: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
  };
}

function browser(browserPage: ReturnType<typeof page>) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockResolvedValue([browserPage]),
    newPage: vi.fn().mockResolvedValue(browserPage),
    sessionId: vi.fn().mockReturnValue("taishin-session"),
  };
}

function rejectLoginSequence(
  browserPage: ReturnType<typeof page>,
  detail: string,
) {
  browserPage.evaluate
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(selectors)
    .mockResolvedValueOnce(captchaTarget)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(detail);
}

beforeEach(() => {
  vi.clearAllMocks();
  puppeteerMock.sessions.mockResolvedValue([]);
  puppeteerMock.limits.mockResolvedValue({
    activeSessions: [],
    maxConcurrentSessions: 3,
    allowedBrowserAcquisitions: 1,
    timeUntilNextAllowedBrowserAcquisition: 0,
  });
});

describe("Taishin browser session lifecycle", () => {
  it("reuses valid encrypted cookies without running OCR", async () => {
    const browserPage = page();
    const response = (value: unknown) => ({
      ok: true,
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({ value, error: null }),
    });
    const activeSession = {
      ok: true,
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({
        RESULT: "SUCCESS",
        DBSESSIONID: "database-session",
      }),
    };
    browserPage.evaluate
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce(
        response({
          "001": {
            "OUT-AVAIL-CREDIT": "100000",
            "OUT-STMT-BALANCE": "1200",
            "OUT-CRLIMIT-PERM": "200000",
          },
        }),
      )
      .mockResolvedValueOnce(response({ fmtRealTxListMap: [] }))
      .mockResolvedValueOnce(
        response({
          showAccoutnYM: "2026/07",
          showCbalance: "1200",
          showCdue: "1200",
          newAcctDetailList: [],
        }),
      );
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn();

    const result = await createTaishinConnector({} as Fetcher, recognize).sync({
      ...credentials,
      lookbackMonths: 1,
      sessionCookies: JSON.stringify([
        {
          name: "SESSION",
          value: "encrypted-at-rest",
          domain: "my.taishinbank.com.tw",
        },
      ]),
    });

    expect(browserPage.setCookie).toHaveBeenCalledOnce();
    expect(recognize).not.toHaveBeenCalled();
    expect(result.bankAccounts).toHaveLength(1);
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("reuses the same browser for manual CAPTCHA and disconnects it", async () => {
    const browserPage = page();
    browserPage.evaluate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(selectors)
      .mockResolvedValueOnce(captchaTarget);
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    const result = await prepareTaishinCaptcha({} as Fetcher, {
      ...credentials,
      browserSessionId: "taishin-session",
    });

    expect(puppeteerMock.connect).toHaveBeenCalledWith({}, "taishin-session");
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
    expect(browserInstance.disconnect).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      browserSessionId: "taishin-session",
      captchaImage: "data:image/jpeg;base64,AQID",
      captchaDigitCount: 6,
    });
  });

  it("closes the manual browser when CAPTCHA verification fails", async () => {
    const browserPage = page();
    browserPage.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce("驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    await expect(
      createTaishinConnector({} as Fetcher).sync({
        ...credentials,
        browserSessionId: "taishin-session",
        browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        captchaDigitCount: 6,
        captcha: "123456",
      }),
    ).rejects.toThrow("圖形驗證碼錯誤");

    expect(browserInstance.close).toHaveBeenCalledOnce();
    expect(browserInstance.disconnect).not.toHaveBeenCalled();
  });

  it("clicks a visible div used as the login button", async () => {
    const browserPage = page();
    const loginButton = {
      tagName: "DIV",
      innerText: "登入網銀",
      hidden: false,
      title: "",
      dataset: {} as Record<string, string>,
      getAttribute: vi.fn().mockReturnValue(null),
      getBoundingClientRect: vi
        .fn()
        .mockReturnValue({ width: 300, height: 50 }),
      matches: vi.fn().mockReturnValue(false),
    };
    browserPage.evaluate
      .mockImplementationOnce(async (callback: () => unknown) => {
        vi.stubGlobal("document", {
          querySelectorAll: vi.fn().mockReturnValue([loginButton]),
        });
        try {
          return callback();
        } finally {
          vi.unstubAllGlobals();
        }
      })
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce("驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.sessions.mockResolvedValue([
      { sessionId: "taishin-session", startTime: Date.now() },
    ]);
    puppeteerMock.connect.mockResolvedValue(browserInstance);

    await expect(
      createTaishinConnector({} as Fetcher).sync({
        ...credentials,
        browserSessionId: "taishin-session",
        browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        captchaDigitCount: 6,
        captcha: "123456",
      }),
    ).rejects.toThrow("圖形驗證碼錯誤");

    expect(loginButton.dataset.taishinLogin).toBe("submit");
    expect(browserPage.click).toHaveBeenCalledWith(
      '[data-taishin-login="submit"]',
    );
  });

  it("stops automatic login immediately when credentials are rejected", async () => {
    const browserPage = page();
    rejectLoginSequence(browserPage, "使用者密碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");

    await expect(
      createTaishinConnector({} as Fetcher, recognize).sync(credentials),
    ).rejects.toBeInstanceOf(TaishinCredentialRejectedError);

    expect(recognize).toHaveBeenCalledOnce();
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("tries three fresh CAPTCHAs before requiring manual verification", async () => {
    const browserPage = page();
    rejectLoginSequence(browserPage, "驗證碼錯誤");
    rejectLoginSequence(browserPage, "驗證碼錯誤");
    rejectLoginSequence(browserPage, "驗證碼錯誤");
    const browserInstance = browser(browserPage);
    puppeteerMock.launch.mockResolvedValue(browserInstance);
    const recognize = vi.fn().mockResolvedValue("123456");

    await expect(
      createTaishinConnector({} as Fetcher, recognize).sync(credentials),
    ).rejects.toThrow("連續失敗 3 次");

    expect(recognize).toHaveBeenCalledTimes(3);
    expect(browserPage.goto).toHaveBeenCalledTimes(3);
    expect(browserInstance.close).toHaveBeenCalledOnce();
  });

  it("maps Browser Rendering capacity limits to a typed retryable error", async () => {
    puppeteerMock.limits.mockResolvedValue({
      allowedBrowserAcquisitions: 0,
      timeUntilNextAllowedBrowserAcquisition: 20_000,
    });

    await expect(
      prepareTaishinCaptcha({} as Fetcher, credentials),
    ).rejects.toBeInstanceOf(TaishinBrowserCapacityError);
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
  });
});
