import { beforeEach, describe, expect, it, vi } from "vitest";

const puppeteerMock = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  limits: vi.fn(),
  sessions: vi.fn()
}));
const jpegMock = vi.hoisted(() => ({
  decode: vi.fn(() => ({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }))
}));

vi.mock("@cloudflare/puppeteer", () => ({ default: puppeteerMock }));
vi.mock("jpeg-js", () => jpegMock);

import {
  createSinopacConnector,
  prepareSinopacCaptcha,
  SinopacBrowserCapacityError,
  SinopacVerificationRequiredError
} from "./sinopac";

const credentials = {
  userId: "A123456789",
  account: "test-user",
  password: "test-password"
};

function captchaPage() {
  return {
    $: vi.fn().mockResolvedValue({ screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) }),
    goto: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("https://mma.sinopac.com/MemberPortal/Member/NextWebLogin.aspx"),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  puppeteerMock.sessions.mockResolvedValue([]);
  puppeteerMock.limits.mockResolvedValue({
    activeSessions: [],
    maxConcurrentSessions: 3,
    allowedBrowserAcquisitions: 1,
    timeUntilNextAllowedBrowserAcquisition: 0
  });
});

describe("sinopac browser session lifecycle", () => {
  it("requires one-time verification before acquiring a browser when no bank cookies exist", async () => {
    await expect(createSinopacConnector({} as Fetcher).sync(credentials)).rejects.toBeInstanceOf(
      SinopacVerificationRequiredError
    );
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
  });

  it("reuses the exact pending captcha browser instead of launching another one", async () => {
    const page = captchaPage();
    const browser = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
      pages: vi.fn().mockResolvedValue([page]),
      sessionId: vi.fn().mockReturnValue("pending-session")
    };
    puppeteerMock.sessions.mockResolvedValue([{ sessionId: "pending-session", startTime: Date.now() }]);
    puppeteerMock.connect.mockResolvedValue(browser);

    const result = await prepareSinopacCaptcha({} as Fetcher, {
      ...credentials,
      browserSessionId: "pending-session"
    });

    expect(puppeteerMock.connect).toHaveBeenCalledWith({}, "pending-session");
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
    expect(browser.disconnect).toHaveBeenCalledOnce();
    expect(result.browserSessionId).toBe("pending-session");
    expect(result.captchaImage).toBe("data:image/jpeg;base64,AQID");
  });

  it("closes a submitted CAPTCHA browser when verification fails", async () => {
    const page = {
      type: vi.fn().mockRejectedValue(new Error("invalid captcha")),
      url: vi.fn().mockReturnValue("https://mma.sinopac.com/MemberPortal/Member/NextWebLogin.aspx")
    };
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn().mockResolvedValue([page])
    };
    puppeteerMock.connect.mockResolvedValue(browser);

    await expect(createSinopacConnector({} as Fetcher).sync({
      ...credentials,
      captcha: "123456",
      browserSessionId: "pending-session",
      browserSessionExpiresAt: new Date(Date.now() + 60_000).toISOString()
    })).rejects.toBeInstanceOf(SinopacVerificationRequiredError);

    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.disconnect).not.toHaveBeenCalled();
  });

  it("does not launch when the pending captcha browser is still connected", async () => {
    puppeteerMock.sessions.mockResolvedValue([{
      sessionId: "pending-session",
      startTime: Date.now(),
      connectionId: "busy-connection"
    }]);

    await expect(prepareSinopacCaptcha({} as Fetcher, {
      ...credentials,
      browserSessionId: "pending-session"
    })).rejects.toBeInstanceOf(SinopacBrowserCapacityError);
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
  });

  it("returns a typed capacity error before launch when acquisition is rate limited", async () => {
    puppeteerMock.limits.mockResolvedValue({
      activeSessions: [],
      maxConcurrentSessions: 3,
      allowedBrowserAcquisitions: 0,
      timeUntilNextAllowedBrowserAcquisition: 20_000
    });

    await expect(prepareSinopacCaptcha({} as Fetcher, credentials)).rejects.toMatchObject({
      name: "SinopacBrowserCapacityError",
      retryAfterSeconds: 20
    });
    expect(puppeteerMock.launch).not.toHaveBeenCalled();
  });
});
