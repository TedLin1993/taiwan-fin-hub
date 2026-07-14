import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AppBindings, Env } from "./env";
import {
  apiErrorResponse,
  demoReadOnlyMiddleware,
  isDemoMode,
  parsePagination
} from "./http";

function testApp() {
  const app = new Hono<AppBindings>();
  app.use("*", demoReadOnlyMiddleware);
  app.get("/resource", (c) => c.json({ ok: true }));
  app.put("/resource", (c) => c.json({ updated: true }));
  return app;
}

const demoEnv = { DEMO_MODE: "true" } as Env;

describe("demo read-only middleware", () => {
  it("allows reads", async () => {
    const response = await testApp().request("/resource", undefined, demoEnv);
    expect(response.status).toBe(200);
  });

  it("blocks writes before a route handler can mutate state", async () => {
    const response = await testApp().request("/resource", { method: "PUT" }, demoEnv);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEMO_MODE_READ_ONLY" }
    });
  });

  it("recognizes supported demo mode values", () => {
    expect(isDemoMode({ DEMO_MODE: true })).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "YES" })).toBe(true);
    expect(isDemoMode({ DEMO_MODE: "false" })).toBe(false);
  });
});

describe("HTTP helpers", () => {
  it("coerces and bounds pagination input", () => {
    expect(parsePagination({ limit: "25", offset: "50" })).toEqual({ limit: 25, offset: 50 });
    expect(() => parsePagination({ limit: "101" })).toThrow(z.ZodError);
  });

  it("maps validation errors to 400 without exposing details", async () => {
    const response = apiErrorResponse(new z.ZodError([]));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("maps unexpected errors to a generic 500 response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiErrorResponse(new Error("secret database detail"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret database detail");
    spy.mockRestore();
  });
});
