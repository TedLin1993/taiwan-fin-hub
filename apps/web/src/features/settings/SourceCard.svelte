<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChartCandlestick, Landmark, ReceiptText } from "@lucide/svelte";
  import { toStore } from "svelte/store";
  import { createQuery } from "@tanstack/svelte-query";
  import Button from "../../components/ui/Button.svelte";
  import Badge from "../../components/ui/Badge.svelte";
  import Card from "../../components/ui/Card.svelte";
  import CardContent from "../../components/ui/CardContent.svelte";
  import type { ApiClient } from "../../lib/api";
  import { connectorSettingsQuery } from "../../lib/queries";
  import type { ConnectorId, SyncJobRow } from "../../lib/types";
  import { formatDateTime } from "../../lib/format.svelte";
  let {
    api,
    id,
    title,
    description,
    selected,
    onConfigure,
    jobs,
    children,
  }: {
    api: ApiClient;
    id: ConnectorId;
    title: string;
    description: string;
    selected: boolean;
    onConfigure: () => void;
    jobs?: SyncJobRow[];
    children?: Snippet;
  } = $props();
  const settings = createQuery(
    toStore(() => connectorSettingsQuery(() => api, id)),
  );
  const job = $derived(
    (jobs ?? []).find(
      (item) => item.connectorId === id && item.scope === "all",
    ),
  );
  const needsAction = $derived(
    job?.lastStatus === "failed" || job?.lastStatus === "needs_user_action",
  );
  const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const scheduleLabel = $derived(
    !job?.enabled
      ? "關閉"
      : job.scheduleMode === "inherit"
        ? "跟隨預設"
        : job.intervalMinutes === 1440
          ? `每天 ${job.preferredTime}`
          : job.intervalMinutes === 10080
            ? `每${weekdays[job.preferredWeekday] ?? "週一"} ${job.preferredTime}`
            : `每 ${job.intervalMinutes / 60} 小時`,
  );
  const SourceIcon = $derived(
    id === "einvoice"
      ? ReceiptText
      : id === "tdcc"
        ? ChartCandlestick
        : Landmark,
  );
</script>

<Card
  class={`transition duration-200 ${selected ? "sm:col-span-2 lg:col-span-3 2xl:col-span-5 border-steel/50 shadow-md ring-2 ring-steel/15" : "hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-sm"}`}
  ><CardContent class="pt-5"
    ><div class="flex items-start justify-between gap-4">
      <div class="flex min-w-0 items-start gap-3">
        <span
          class={`flex size-10 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-steel text-white" : "bg-steel/10 text-steel"}`}
        >
          <SourceIcon class="size-5" />
        </span>
        <div class="min-w-0">
          <h2 class="font-semibold">{title}</h2>
          <p class="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Badge
        class="shrink-0 whitespace-nowrap"
        variant={needsAction
          ? "destructive"
          : $settings.data?.configured
            ? "success"
            : "secondary"}
        >{needsAction
          ? "需要處理"
          : $settings.data?.configured
            ? "已設定"
            : "未設定"}</Badge
      >
    </div>
    <div
      class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
    >
      <div class="text-xs text-muted-foreground">
        <p>
          上次成功：{job?.lastSuccessAt
            ? formatDateTime(job.lastSuccessAt)
            : "尚無紀錄"}
        </p>
        <p class="mt-1">
          排程：{scheduleLabel}
        </p>
      </div>
      <Button
        size="sm"
        variant={selected ? "default" : "outline"}
        aria-expanded={selected}
        onclick={onConfigure}>{selected ? "收合" : "管理設定"}</Button
      >
    </div>
    {#if selected && children}
      <div class="mt-5 border-t border-border pt-5">
        {@render children()}
      </div>
    {/if}</CardContent
  ></Card
>
