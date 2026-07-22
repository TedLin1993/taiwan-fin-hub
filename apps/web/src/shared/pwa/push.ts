export type PushSupport = {
  supported: boolean;
  reason?: "browser" | "ios-home-screen";
};

type PushSubscriptionJson = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export function pushSupport(): PushSupport {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { supported: false, reason: "browser" };
  }

  if (isIosDevice() && !isStandalonePwa()) {
    return { supported: false, reason: "ios-home-screen" };
  }

  return { supported: true };
}

export async function registerPushServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("此瀏覽器不支援 Service Worker。");
  }
  return navigator.serviceWorker.register("/sw.js");
}

export async function getPushSubscription(publicKey: string) {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (!existing || pushSubscriptionUsesKey(existing, publicKey))
    return existing;

  await existing.unsubscribe();
  return null;
}

export async function subscribeToPush(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "通知權限已被拒絕，請到瀏覽器設定中重新開啟。"
        : "尚未授予通知權限。",
    );
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await getPushSubscription(publicKey);
  return (
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    }))
  );
}

export function subscriptionInput(subscription: PushSubscription) {
  const value = subscription.toJSON() as PushSubscriptionJson;
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error("瀏覽器未提供完整的推播訂閱資料。");
  }
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: {
      p256dh: value.keys.p256dh,
      auth: value.keys.auth,
    },
  };
}

export function pushSubscriptionUsesKey(
  subscription: PushSubscription,
  publicKey: string,
) {
  const configuredKey = base64UrlToUint8Array(publicKey);
  const subscriptionKey = subscription.options.applicationServerKey;
  if (
    !subscriptionKey ||
    subscriptionKey.byteLength !== configuredKey.byteLength
  ) {
    return false;
  }

  const subscriptionBytes = new Uint8Array(subscriptionKey);
  return configuredKey.every(
    (byte, index) => byte === subscriptionBytes[index],
  );
}

export function isStandalonePwa() {
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosDevice() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function base64UrlToUint8Array(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
