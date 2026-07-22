import type {
  NotificationConfig,
  NotificationPreferences,
  PushSubscriptionInput,
} from "@taiwan-fin-hub/core";
import { configEncryptionKey } from "../../platform/config";
import { decryptJson, encryptJson } from "../../platform/crypto";
import type { Env } from "../../platform/env";
import { isDemoMode } from "../../platform/http";
import {
  countPushSubscriptions,
  getNotificationPreferences,
  listPushSubscriptions,
  markPushFailure,
  markPushSuccess,
  normalizePushSubscription,
  removePushSubscription,
  saveNotificationPreferences,
  upsertPushSubscription,
} from "./repository";
import {
  shouldNotify,
  syncNotificationPayload,
  type PushNotificationPayload,
  type SyncNotificationEvent,
} from "./payload";
import webpush, { WebPushError } from "web-push";

export class PushNotificationConfigurationError extends Error {}

const DEFAULT_VAPID_SUBJECT = "mailto:admin@example.com";

type VapidConfiguration = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function vapidConfiguration(env: Env): VapidConfiguration | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT,
  };
}

export function isPushConfigured(env: Env) {
  return vapidConfiguration(env) !== null;
}

function requirePushConfiguration(env: Env) {
  const configuration = vapidConfiguration(env);
  if (!configuration) {
    throw new PushNotificationConfigurationError(
      "VAPID public and private keys are not configured.",
    );
  }
  return configuration;
}

export async function getNotificationConfig(
  env: Env,
): Promise<NotificationConfig> {
  if (isDemoMode(env)) {
    return {
      enabled: false,
      publicKey: null,
      subscribedDevices: 0,
      preferences: {
        success: false,
        failed: true,
        needsUserAction: true,
      },
    };
  }
  const configuration = vapidConfiguration(env);
  return {
    enabled: configuration !== null,
    publicKey: configuration?.publicKey ?? null,
    subscribedDevices: await countPushSubscriptions(env.DB),
    preferences: await getNotificationPreferences(env.DB),
  };
}

export async function registerPushSubscription(
  env: Env,
  input: PushSubscriptionInput,
) {
  validatePushEndpoint(input.endpoint);
  const normalized = normalizePushSubscription(input);
  const id = await endpointId(normalized.endpoint);
  const now = new Date().toISOString();
  await upsertPushSubscription(env.DB, {
    id,
    encryptedSubscription: await encryptJson(
      normalized,
      configEncryptionKey(env),
    ),
    now,
  });
  return { id };
}

export async function unregisterPushSubscription(env: Env, id: string) {
  await removePushSubscription(env.DB, id);
  return { success: true as const };
}

export async function updateNotificationPreferences(
  env: Env,
  preferences: NotificationPreferences,
) {
  await saveNotificationPreferences(
    env.DB,
    preferences,
    new Date().toISOString(),
  );
  return preferences;
}

export async function sendTestNotification(env: Env) {
  requirePushConfiguration(env);
  return deliverPushPayload(env, {
    title: "推播測試成功",
    body: "Taiwan Fin Hub 已經可以通知你同步狀態。",
    url: "/#/settings",
    tag: "notification-test",
  });
}

export async function safelySendSyncNotification(
  env: Env,
  event: SyncNotificationEvent,
) {
  try {
    const preferences = await getNotificationPreferences(env.DB);
    if (!shouldNotify(preferences, event.status)) return;
    if (!isPushConfigured(env)) {
      console.warn("[notifications] skipped: VAPID keys are not configured");
      return;
    }
    await deliverPushPayload(env, syncNotificationPayload(event));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "push_notification_failed",
        connectorId: event.connectorId,
        status: event.status,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function deliverPushPayload(env: Env, payload: PushNotificationPayload) {
  const { publicKey, privateKey, subject } = requirePushConfiguration(env);
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const subscriptions = await listPushSubscriptions(env.DB);
  const encryptionKey = configEncryptionKey(env);
  let delivered = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        const subscription = await decryptJson<PushSubscriptionInput>(
          row.encrypted_subscription,
          encryptionKey,
        );
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 60 * 60,
          urgency: payload.tag.includes("needs-action") ? "high" : "normal",
          topic: payload.tag,
        });
        delivered += 1;
        await markPushSuccess(env.DB, row.id, new Date().toISOString());
      } catch (error) {
        const statusCode = error instanceof WebPushError ? error.statusCode : 0;
        if (statusCode === 404 || statusCode === 410) {
          await removePushSubscription(env.DB, row.id);
          removed += 1;
          return;
        }
        await markPushFailure(env.DB, row.id, new Date().toISOString());
        console.warn(
          JSON.stringify({
            event: "push_subscription_delivery_failed",
            subscriptionId: row.id,
            statusCode,
          }),
        );
      }
    }),
  );

  return { delivered, removed, attempted: subscriptions.length };
}

function validatePushEndpoint(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Push subscription endpoint must be a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    isPrivateHostname(parsed.hostname)
  ) {
    throw new Error("Push subscription endpoint must be a public HTTPS URL.");
  }
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (host.includes(":")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.")
  )
    return true;
  const private172 = /^172\.(\d{1,3})\./.exec(host);
  return Boolean(
    private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31,
  );
}

async function endpointId(endpoint: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
