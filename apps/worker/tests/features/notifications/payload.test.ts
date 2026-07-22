import { describe, expect, it } from "vitest";
import type { NotificationPreferences } from "@taiwan-fin-hub/core";
import {
  shouldNotify,
  syncNotificationPayload,
} from "../../../src/features/notifications/payload";

describe("sync notification payload", () => {
  it("keeps success notifications opt-in and safe for display", () => {
    const payload = syncNotificationPayload({
      connectorId: "esun",
      status: "success",
    });

    expect(payload).toEqual({
      title: "同步完成",
      body: "玉山銀行已完成排程同步。",
      url: "/#/overview",
      tag: "sync-esun-success",
    });
  });

  it("does not expose connector error details", () => {
    const payload = syncNotificationPayload({
      connectorId: "tdcc",
      status: "needs_user_action",
    });

    expect(payload.body).not.toContain("OTP");
    expect(payload.url).toBe("/#/data-sources");
  });

  it("maps statuses to their preference switches", () => {
    const preferences: NotificationPreferences = {
      success: false,
      failed: true,
      needsUserAction: true,
    };

    expect(shouldNotify(preferences, "success")).toBe(false);
    expect(shouldNotify(preferences, "failed")).toBe(true);
    expect(shouldNotify(preferences, "needs_user_action")).toBe(true);
  });
});
