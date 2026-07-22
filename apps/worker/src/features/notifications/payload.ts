import type {
  ConnectorId,
  NotificationPreferences,
  SyncNotificationStatus,
} from "@taiwan-fin-hub/core";

export type SyncNotificationEvent = {
  connectorId: ConnectorId;
  status: SyncNotificationStatus;
};

export type PushNotificationPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

const connectorLabels: Record<ConnectorId, string> = {
  einvoice: "電子發票",
  tdcc: "集保 e 存摺",
  esun: "玉山銀行",
  cathaybk: "國泰世華銀行",
  sinopac: "永豐行動銀行",
};

export function syncNotificationPayload(
  event: SyncNotificationEvent,
): PushNotificationPayload {
  const connector = connectorLabels[event.connectorId];
  if (event.status === "success") {
    return {
      title: "同步完成",
      body: `${connector}已完成排程同步。`,
      url: "/#/overview",
      tag: `sync-${event.connectorId}-success`,
    };
  }

  if (event.status === "needs_user_action") {
    return {
      title: "需要你的操作",
      body: `${connector}需要重新驗證，請開啟 App 處理。`,
      url: "/#/data-sources",
      tag: `sync-${event.connectorId}-needs-action`,
    };
  }

  return {
    title: "同步失敗",
    body: `${connector}同步失敗，請開啟 App 查看狀態。`,
    url: "/#/data-sources",
    tag: `sync-${event.connectorId}-failed`,
  };
}

export function shouldNotify(
  preferences: NotificationPreferences,
  status: SyncNotificationStatus,
) {
  if (status === "success") return preferences.success;
  if (status === "needs_user_action") return preferences.needsUserAction;
  return preferences.failed;
}
