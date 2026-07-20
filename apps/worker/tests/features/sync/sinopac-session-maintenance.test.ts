import { describe, expect, it } from "vitest";
import { sinopacSessionNeedsRefresh } from "../../../src/features/sync/service";

const now = new Date("2026-07-20T02:00:00.000Z");
const sessionCookies = JSON.stringify([
  { name: "ASP.NET_SessionId", value: "active-session", domain: "m.sinopac.com" },
]);

describe("sinopac scheduled session maintenance", () => {
  it("refreshes when the session has twelve minutes or less remaining", () => {
    expect(sinopacSessionNeedsRefresh({
      sessionCookies,
      sessionExpiresAt: "2026-07-20T02:12:00.000Z",
      protocol: "sinopac-mobile-app-json-v1",
    }, now)).toBe(true);
  });

  it("does not refresh a recently renewed session", () => {
    expect(sinopacSessionNeedsRefresh({
      sessionCookies,
      sessionExpiresAt: "2026-07-20T02:13:00.000Z",
      protocol: "sinopac-mobile-app-json-v1",
    }, now)).toBe(false);
  });

  it("refreshes a reusable legacy state that has no local expiry estimate", () => {
    expect(sinopacSessionNeedsRefresh({
      sessionCookies,
      protocol: "sinopac-mobile-app-json-v1",
    }, now)).toBe(true);
  });

  it("ignores missing and incompatible sessions", () => {
    expect(sinopacSessionNeedsRefresh({}, now)).toBe(false);
    expect(sinopacSessionNeedsRefresh({
      sessionCookies,
      protocol: "legacy-mobile-web",
    }, now)).toBe(false);
  });
});
