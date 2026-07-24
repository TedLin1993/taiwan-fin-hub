import { parseConnectorConfig } from "@taiwan-fin-hub/connectors";
import type { ConnectorId } from "@taiwan-fin-hub/core";
import { clearConnectorCursor } from "@taiwan-fin-hub/db";
import { configEncryptionKey } from "../../platform/config";
import { decryptJson, encryptJson } from "../../platform/crypto";
import type { Env } from "../../platform/env";
import { findConnectorSettings, saveConnectorSettings } from "./repository";

const PUBLIC_FIELDS: Record<string, string[]> = {
  esun: ["lookbackMonths"],
  cathaybk: ["lookbackMonths"],
  sinopac: ["lookbackMonths"],
  taishin: ["lookbackMonths"],
  einvoice: ["periodsBack", "fetchDetails"],
};

export class ConnectorConfigMissingError extends Error {}
export class InvalidConnectorConfigError extends Error {}

export async function getConnectorSettingsView(
  env: Env,
  connectorId: ConnectorId,
) {
  const settings = await findConnectorSettings(env.DB, connectorId);
  let sessionAvailable = false;
  let credentialsComplete = Boolean(settings);
  if ((connectorId === "sinopac" || connectorId === "taishin") && settings) {
    const stored = await decryptJson<Record<string, unknown>>(
      settings.encrypted_config,
      configEncryptionKey(env),
    );
    credentialsComplete = ["userId", "account", "password"].every(
      (key) => typeof stored[key] === "string" && stored[key].length > 0,
    );
    sessionAvailable =
      typeof stored.sessionCookies === "string" &&
      stored.sessionCookies.length > 0 &&
      (connectorId === "taishin" ||
        stored.protocol === "sinopac-mobile-app-json-v1");
  }
  if (connectorId === "tdcc" && settings) {
    const stored = await decryptJson<Record<string, unknown>>(
      settings.encrypted_config,
      configEncryptionKey(env),
    );
    credentialsComplete =
      typeof stored.userId === "string" &&
      stored.userId.length > 0 &&
      typeof stored.password === "string" &&
      stored.password.length > 0;
    sessionAvailable = credentialsComplete && Boolean(settings.sync_cursor);
  }
  return {
    connectorId,
    configured: Boolean(settings),
    updatedAt: settings?.updated_at,
    publicConfig: settings?.public_config
      ? JSON.parse(settings.public_config)
      : null,
    credentialsComplete,
    sessionAvailable,
  };
}

export async function updateConnectorSettings(
  env: Env,
  connectorId: ConnectorId,
  rawConfig: Record<string, unknown>,
) {
  const publicKeys = PUBLIC_FIELDS[connectorId] ?? [];
  const publicConfig: Record<string, unknown> = {};
  const sensitiveConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawConfig)) {
    if (publicKeys.includes(key)) publicConfig[key] = value;
    else sensitiveConfig[key] = value;
  }
  const hasSensitive = Object.values(sensitiveConfig).some(
    (value) => value !== undefined && value !== "",
  );
  const now = new Date().toISOString();
  const encryptionKey = configEncryptionKey(env);
  const existing = await findConnectorSettings(env.DB, connectorId);
  if (!hasSensitive && !existing) throw new ConnectorConfigMissingError();

  let parsedConfig: unknown;
  let mergedPublic: Record<string, unknown>;
  let shouldClearTdccSession = false;
  try {
    const storedConfig = existing
      ? await decryptJson<Record<string, unknown>>(
          existing.encrypted_config,
          encryptionKey,
        )
      : {};
    const storedPublic = existing?.public_config
      ? JSON.parse(existing.public_config)
      : {};
    const mergedConfig: Record<string, unknown> = {
      ...storedConfig,
      ...storedPublic,
      ...rawConfig,
    };
    if (
      connectorId === "einvoice" &&
      einvoiceCredentialsChanged(storedConfig, rawConfig)
    ) {
      for (const key of [
        "userToken",
        "mobileBarcode",
        "sid",
        "token",
        "iv",
        "svrCode",
        "loginAppId",
        "loginLiat",
        "loginSsMe",
        "ltoken",
        "hkey",
        "serverTimeOffset",
      ])
        delete mergedConfig[key];
    }
    if (
      connectorId === "sinopac" &&
      sinopacCredentialsChanged(storedConfig, rawConfig)
    ) {
      for (const key of [
        "sessionCookies",
        "candidateSessionCookies",
        "candidateSessionCreatedAt",
        "sessionExpiresAt",
        "sessionKeepAliveFailures",
        "browserSessionId",
        "browserSessionExpiresAt",
        "captcha",
        "protocol",
      ])
        delete mergedConfig[key];
    }
    if (
      connectorId === "taishin" &&
      bankCredentialsChanged(storedConfig, rawConfig)
    ) {
      for (const key of [
        "sessionCookies",
        "sessionCreatedAt",
        "browserSessionId",
        "browserSessionExpiresAt",
        "captchaDigitCount",
        "captcha",
      ])
        delete mergedConfig[key];
    }
    shouldClearTdccSession =
      connectorId === "tdcc" &&
      Boolean(existing) &&
      tdccCredentialsChanged(storedConfig, rawConfig);
    parsedConfig = parseConnectorConfig(connectorId, mergedConfig);
    mergedPublic = { ...storedPublic, ...publicConfig };
  } catch {
    throw new InvalidConnectorConfigError();
  }

  await saveConnectorSettings(env.DB, {
    id: existing?.id ?? crypto.randomUUID(),
    connectorId,
    encryptedConfig: await encryptJson(parsedConfig, encryptionKey),
    publicConfig:
      Object.keys(mergedPublic).length > 0
        ? JSON.stringify(mergedPublic)
        : null,
    now,
  });
  if (shouldClearTdccSession) {
    await clearConnectorCursor(env.DB, connectorId, now);
  }
  return { connectorId, configured: true, updatedAt: now };
}

function einvoiceCredentialsChanged(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  return ["mobile", "password", "apiKey"].some(
    (key) =>
      key in incoming &&
      incoming[key] !== undefined &&
      incoming[key] !== "" &&
      incoming[key] !== stored[key],
  );
}

function sinopacCredentialsChanged(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  return ["userId", "account", "password"].some(
    (key) =>
      key in incoming &&
      incoming[key] !== undefined &&
      incoming[key] !== "" &&
      incoming[key] !== stored[key],
  );
}

function bankCredentialsChanged(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  return ["userId", "account", "password"].some(
    (key) =>
      key in incoming &&
      incoming[key] !== undefined &&
      incoming[key] !== "" &&
      incoming[key] !== stored[key],
  );
}

function tdccCredentialsChanged(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  return ["userId", "password"].some(
    (key) =>
      key in incoming &&
      incoming[key] !== undefined &&
      incoming[key] !== "" &&
      incoming[key] !== stored[key],
  );
}
