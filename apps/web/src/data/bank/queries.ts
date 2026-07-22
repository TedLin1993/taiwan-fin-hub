import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type { BankData, CreditCardBillRow } from "./types";

type ApiProvider = () => ApiClient;

export const bankQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.bank,
    queryFn: () => getApi().get<BankData>("/api/bank"),
  });

export const creditCardBillsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.bills,
    queryFn: () => getApi().get<CreditCardBillRow[]>("/api/bank/bills"),
  });
