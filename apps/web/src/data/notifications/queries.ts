import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type { NotificationConfig } from "./types";

type ApiProvider = () => ApiClient;

export const notificationConfigQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.notifications,
    queryFn: () =>
      getApi().get<NotificationConfig>("/api/notifications/config"),
  });
