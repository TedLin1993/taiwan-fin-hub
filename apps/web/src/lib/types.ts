import type {
  ApiErrorResponse,
  ConnectorId as CoreConnectorId,
  Summary as CoreSummary,
} from "@taiwan-fin-hub/core";

export interface NetWorthHistoryRow {
  date: string;
  netWorth: number;
  assetType: string;
  source: string;
}
export interface ExchangeRateRow {
  currency: string;
  rateTwd: number;
  updatedAt: string;
}
export interface ManualAssetRow {
  id: string;
  name: string;
  category: string;
  note: string | null;
  createdAt: string;
  value?: number;
  date?: string;
}
export interface ManualAssetHistoryEntry {
  date: string;
  value: number;
}

export type PrimaryView =
  "overview" | "assets" | "activity" | "invoices" | "settings";
export type DetailView = "bank" | "cards" | "investments" | "manual-assets";
export type MobileSettingsView =
  "data-sources" | "exchange-rates" | "classification-rules";
export type View = PrimaryView | DetailView | MobileSettingsView | "more";
export type AssetSection =
  "all" | "bank" | "cards" | "investments" | "manual-assets";
export interface MoneyVisibilityState {
  hidden: boolean;
}
export interface ActivityItem {
  id: string;
  source: "bank" | "card" | "investment" | "invoice";
  date: string;
  title: string;
  subtitle: string;
  amount?: number;
  currency: string;
  category: string;
  categoryId?: string;
  classificationPattern?: string;
  transactionId?: string;
  excludedFromCalculation?: boolean;
  invoiceId?: string;
  invoiceAmount?: number;
  invoiceSearchText?: string;
  status: string;
}
export type ConnectorId = CoreConnectorId;
export type SyncTarget = "default" | "investments" | "bank" | "trades";

export type Summary = CoreSummary;
export interface InvoiceLineItemRow {
  id: string;
  invoiceId?: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
}
export interface InvoiceRow {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  invoiceDate: string;
  invoiceNumber?: string;
  sellerName?: string;
  amount: number;
  items: InvoiceLineItemRow[];
}
export interface InvoiceTransactionPreference {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate";
  updatedAt: string;
}
export interface InvestmentRow {
  id: string;
  assetType: "stock" | "etf" | "fund";
  symbol?: string;
  name: string;
  quantity?: number;
  marketValue?: number;
  cashBalance?: number;
  currency: string;
  asOfDate: string;
}
export interface InvestmentTransactionRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  sourceId: string;
  brokerNo?: string;
  brokerAccount?: string;
  brokerName?: string;
  symbol?: string;
  name?: string;
  assetType?: "stock" | "etf" | "fund" | "bond" | "unknown";
  tradeDate?: string;
  postedDate?: string;
  transactionCode?: string;
  transactionName?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  currency: string;
}
export interface BankAccountRow {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  institutionName?: string;
  accountName?: string;
  accountType?: string;
  currency: string;
  bankCode?: string;
  accountLast4?: string;
  balance?: number;
  availableBalance?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  asOfAt?: string;
}
export interface BankTransactionRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  accountSourceId?: string;
  accountName?: string;
  institutionName?: string;
  accountType?: string;
  bankCode?: string;
  accountLast4?: string;
  sourceId: string;
  postedDate?: string;
  authorizedAt?: string;
  amount: number;
  currency: string;
  description?: string;
  counterparty?: string;
  status: "pending" | "posted";
  excludedFromCalculation: boolean;
  classification?: {
    categoryId: string;
    label: string;
    source: "override" | "user_rule" | "system_rule" | "fallback";
    ruleId?: string;
    excludedFromCalculation?: boolean;
  };
}
export interface CreditCardBillRow {
  id: string;
  connectorId: ConnectorId;
  accountId: string;
  accountSourceId?: string;
  sourceId: string;
  billingPeriod: string;
  statementAmount?: number;
  minimumPayment?: number;
  paidAmount?: number;
  isPaid?: number;
  paymentDueDate?: string;
  statementClosingDate?: string;
  currency: string;
}
export interface BankData {
  accounts: BankAccountRow[];
  transactions: BankTransactionRow[];
}
export interface ConnectorSettings {
  connectorId: ConnectorId;
  configured: boolean;
  updatedAt?: string;
  publicConfig?: Record<string, unknown> | null;
  sessionAvailable?: boolean;
}
export interface SyncJobRow {
  id: string;
  connectorId: ConnectorId;
  scope: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string;
  scheduleMode: "inherit" | "custom";
  preferredTime: string;
  preferredWeekday: number;
  lockedUntil: string | null;
  lockedBy: string | null;
  lockTrigger: "manual" | "scheduled" | null;
  lockScope: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: "success" | "failed" | "needs_user_action" | null;
  lastError: string | null;
  updatedAt: string;
  running: boolean;
}
export interface SyncScheduleSettings {
  intervalMinutes: number;
  preferredTime: string;
  preferredWeekday: number;
  timezone: "Asia/Taipei";
  updatedAt: string;
}
export type ApiError = ApiErrorResponse;
export interface RuntimeInfo {
  demoMode: boolean;
}
export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "checkbox";
  placeholder?: string;
}
export interface ClassificationRuleRow {
  id: string;
  categoryId: string;
  targetType: string;
  field: string;
  operator: string;
  pattern: string;
  priority: number;
  enabled: boolean;
  isSystem: boolean;
  excludedFromCalculation: boolean;
  description?: string;
  createdAt?: string;
}
export interface ClassificationCategoryRow {
  id: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
}
