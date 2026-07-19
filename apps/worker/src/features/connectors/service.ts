import { parseConnectorConfig } from "@taiwan-fin-hub/connectors";
import type { ConnectorId } from "@taiwan-fin-hub/core";
import { configEncryptionKey } from "../../platform/config";
import { decryptJson, encryptJson } from "../../platform/crypto";
import type { Env } from "../../platform/env";
import { findConnectorSettings, saveConnectorSettings } from "./repository";

const PUBLIC_FIELDS: Record<string, string[]> = {
  esun: ["lookbackMonths"],
  cathaybk: ["lookbackMonths"],
  sinopac: ["lookbackMonths"],
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
  if (connectorId === "sinopac" && settings) {
    const stored = await decryptJson<Record<string, unknown>>(
      settings.encrypted_config,
      configEncryptionKey(env),
    );
    sessionAvailable =
      typeof stored.sessionCookies === "string" &&
      stored.sessionCookies.length > 0 &&
      stored.protocol === "sinopac-mobile-app-json-v1";
  }
  return {
    connectorId,
    configured: Boolean(settings),
    updatedAt: settings?.updated_at,
    publicConfig: settings?.public_config
      ? JSON.parse(settings.public_config)
      : null,
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
        "sessionExpiresAt",
        "browserSessionId",
        "browserSessionExpiresAt",
        "captcha",
        "protocol",
      ])
        delete mergedConfig[key];
    }
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
