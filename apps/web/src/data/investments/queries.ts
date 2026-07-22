import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type { InvestmentRow, InvestmentTransactionRow } from "./types";

type ApiProvider = () => ApiClient;

export const investmentsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.investments,
    queryFn: () => getApi().get<InvestmentRow[]>("/api/investments"),
  });

export const investmentTransactionsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.investmentTransactions,
    queryFn: () =>
      getApi().get<InvestmentTransactionRow[]>("/api/investment-transactions"),
  });
