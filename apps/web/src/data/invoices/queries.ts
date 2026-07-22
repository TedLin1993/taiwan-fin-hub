import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type { InvoiceRow, InvoiceTransactionPreference } from "./types";

type ApiProvider = () => ApiClient;

export const invoicesQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.invoices,
    queryFn: () => getApi().get<InvoiceRow[]>("/api/invoices"),
  });

export const invoiceTransactionMappingsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.invoiceTransactionMappings,
    queryFn: () =>
      getApi().get<InvoiceTransactionPreference[]>(
        "/api/activity/invoice-mappings",
      ),
  });
