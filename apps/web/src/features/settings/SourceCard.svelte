<script lang="ts">
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
  let { api, id, title, description, selected, onConfigure, jobs }: { api: ApiClient; id: ConnectorId; title: string; description: string; selected: boolean; onConfigure: () => void; jobs?: SyncJobRow[] } = $props();
  const settings = createQuery(toStore(() => connectorSettingsQuery(() => api, id)));
  const job = $derived((jobs ?? []).find((item) => item.connectorId === id && item.scope === "all"));
  const needsAction = $derived(job?.lastStatus === "failed" || job?.lastStatus === "needs_user_action");
</script>
<Card class={selected ? "ring-2 ring-ring/30" : ""}><CardContent class="pt-5"><div class="flex items-start justify-between gap-4"><div class="min-w-0"><h2 class="text-lg font-semibold">{title}</h2><p class="mt-1 text-sm text-muted-foreground">{description}</p></div><Badge variant={needsAction ? "destructive" : $settings.data?.configured ? "success" : "secondary"}>{needsAction ? "需要處理" : $settings.data?.configured ? "已設定" : "未設定"}</Badge></div><div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div class="text-xs text-muted-foreground"><p>上次成功：{job?.lastSuccessAt ? formatDateTime(job.lastSuccessAt) : "尚無紀錄"}</p><p class="mt-1">排程：{job?.enabled ? `${job.intervalMinutes / 60} 小時` : "關閉"}</p></div><Button size="sm" variant={selected ? "default" : "outline"} onclick={onConfigure}>{selected ? "收合設定" : "設定"}</Button></div></CardContent></Card>
