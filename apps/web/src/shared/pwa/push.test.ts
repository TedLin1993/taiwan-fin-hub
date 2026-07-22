import { describe, expect, it } from "vitest";
import { pushSubscriptionUsesKey } from "./push";

function subscriptionWithKey(key: ArrayBuffer | null) {
  return {
    options: { applicationServerKey: key },
  } as unknown as PushSubscription;
}

describe("push subscription VAPID key matching", () => {
  it("recognizes a subscription created with the configured key", () => {
    const key = Uint8Array.from([1, 2, 3]).buffer;

    expect(pushSubscriptionUsesKey(subscriptionWithKey(key), "AQID")).toBe(
      true,
    );
  });

  it("rejects subscriptions created with another key or no key", () => {
    const differentKey = Uint8Array.from([1, 2, 4]).buffer;

    expect(
      pushSubscriptionUsesKey(subscriptionWithKey(differentKey), "AQID"),
    ).toBe(false);
    expect(pushSubscriptionUsesKey(subscriptionWithKey(null), "AQID")).toBe(
      false,
    );
  });
});
