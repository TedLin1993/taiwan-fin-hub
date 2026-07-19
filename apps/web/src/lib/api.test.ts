import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";

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
});
