import type { ConnectorField, ConnectorId } from "./types";

export interface ConnectorDefinition {
  id: ConnectorId;
  title: string;
  description: string;
}

export const connectorDefinitions: ConnectorDefinition[] = [
  { id: "einvoice", title: "電子發票", description: "財政部載具與品項明細" },
  {
    id: "tdcc",
    title: "集保 e 存摺",
    description: "持倉、投資交易與銀行帳戶",
  },
  { id: "esun", title: "玉山銀行", description: "帳戶、信用卡與交易" },
  {
    id: "cathaybk",
    title: "國泰世華銀行",
    description: "帳戶與交易",
  },
  {
    id: "sinopac",
    title: "永豐行動銀行",
    description: "信用卡帳務、近期帳單與消費",
  },
];

export const connectorFields: Record<ConnectorId, ConnectorField[]> = {
  einvoice: [
    { key: "mobile", label: "手機號碼（電子發票帳號）", type: "text" },
    { key: "password", label: "電子發票 App 登入密碼", type: "password" },
    {
      key: "periodsBack",
      label: "往回期數",
      type: "number",
      placeholder: "6",
    },
    { key: "fetchDetails", label: "同步品項明細", type: "checkbox" },
  ],
  tdcc: [
    { key: "userId", label: "身分證字號", type: "text" },
    { key: "password", label: "集保 App 密碼", type: "password" },
  ],
  esun: [
    { key: "username", label: "使用者名稱", type: "text" },
    { key: "password", label: "密碼", type: "password" },
    {
      key: "lookbackMonths",
      label: "往回月份",
      type: "number",
      placeholder: "3",
    },
  ],
  cathaybk: [
    { key: "username", label: "使用者名稱", type: "text" },
    { key: "password", label: "密碼", type: "password" },
    {
      key: "lookbackMonths",
      label: "往回月份",
      type: "number",
      placeholder: "3",
    },
  ],
  sinopac: [
    { key: "userId", label: "身分證字號／統編", type: "text" },
    { key: "account", label: "行動／網路銀行使用者代碼", type: "text" },
    { key: "password", label: "網路密碼", type: "password" },
    {
      key: "lookbackMonths",
      label: "帳單往回月份",
      type: "number",
      placeholder: "3",
    },
  ],
};
