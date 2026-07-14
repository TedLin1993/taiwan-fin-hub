import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "./api";
import { queryKeys } from "./api";
import type {
  BankData,
  ClassificationRuleRow,
  ConnectorSettings,
  CreditCardBillRow,
  ExchangeRateRow,
  InvestmentRow,
  InvestmentTransactionRow,
  InvoiceRow,
  ManualAssetHistoryEntry,
  ManualAssetRow,
  NetWorthHistoryRow,
  SyncJobRow
} from "./types";

type ApiProvider = () => ApiClient;

export const bankQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.bank,
  queryFn: () => getApi().get<BankData>("/api/bank")
});

export const creditCardBillsQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.bills,
  queryFn: () => getApi().get<CreditCardBillRow[]>("/api/bank/bills")
});

export const investmentsQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.investments,
  queryFn: () => getApi().get<InvestmentRow[]>("/api/investments")
});

export const investmentTransactionsQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.investmentTransactions,
  queryFn: () => getApi().get<InvestmentTransactionRow[]>("/api/investment-transactions")
});

export const invoicesQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.invoices,
  queryFn: () => getApi().get<InvoiceRow[]>("/api/invoices")
});

export const manualAssetsQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.manualAssets,
  queryFn: () => getApi().get<ManualAssetRow[]>("/api/manual-assets")
});

export const manualAssetHistoryQuery = (getApi: ApiProvider, assetId: string | null) => queryOptions({
  queryKey: queryKeys.manualAssetHistory(assetId ?? ""),
  queryFn: () => getApi().get<ManualAssetHistoryEntry[]>(`/api/manual-assets/${assetId}/history`),
  enabled: Boolean(assetId)
});

export const exchangeRatesQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.exchangeRates,
  queryFn: () => getApi().get<ExchangeRateRow[]>("/api/exchange-rates")
});

export const netWorthHistoryQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.netWorthHistory,
  queryFn: () => getApi().get<NetWorthHistoryRow[]>("/api/history/net-worth")
});

export const syncJobsQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.syncJobs,
  queryFn: () => getApi().get<SyncJobRow[]>("/api/sync-jobs")
});

export const classificationRulesQuery = (getApi: ApiProvider) => queryOptions({
  queryKey: queryKeys.classificationRules,
  queryFn: () => getApi().get<ClassificationRuleRow[]>("/api/classification/rules")
});

export const connectorSettingsQuery = (getApi: ApiProvider, connectorId: string) => queryOptions({
  queryKey: queryKeys.connectorSettings(connectorId),
  queryFn: () => getApi().get<ConnectorSettings>(`/api/connectors/${connectorId}/settings`)
});
