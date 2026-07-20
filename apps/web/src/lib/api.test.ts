import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApiClient } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it("does not declare JSON when a POST request has no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().post("/api/connectors/sinopac/sync");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connectors/sinopac/sync",
      expect.objectContaining({
        method: "POST",
        body: undefined,
        headers: undefined,
      }),
    );
  });

  it("declares and serializes JSON when a request has a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().post("/api/connectors/sinopac/sync", {
      captcha: "123456",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connectors/sinopac/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ captcha: "123456" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("preserves structured API error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "TDCC_EMAIL_OTP_REQUIRED",
              message: "驗證碼已寄出。",
            },
          }),
          { status: 400 },
        ),
      ),
    );

    const error = await createApiClient()
      .post("/api/connectors/tdcc/sync")
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      code: "TDCC_EMAIL_OTP_REQUIRED",
      message: "驗證碼已寄出。",
      status: 400,
    });
  });
});
