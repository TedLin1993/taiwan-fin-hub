<script lang="ts">
  import { toStore } from "svelte/store";
  import { createMutation, createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { Database, KeyRound, RefreshCw, Save, WalletCards } from "@lucide/svelte";
  import Button from "../components/ui/Button.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { ConnectorField, ConnectorId, ConnectorSettings, SyncJobRow, SyncTarget } from "../lib/types";
  import { formatDateTime } from "../lib/format.svelte";

  let { api, connectorId, demoMode, title, fields }: { api: ApiClient; connectorId: ConnectorId; demoMode: boolean; title: string; fields: ConnectorField[] } = $props();
  const qc = useQueryClient();
  const settings = createQuery<ConnectorSettings>(toStore(() => ({ queryKey: queryKeys.connectorSettings(connectorId), queryFn: () => api.get<ConnectorSettings>(`/api/connectors/${connectorId}/settings`) })));
  const jobs = createQuery<SyncJobRow[]>({ queryKey: queryKeys.syncJobs, queryFn: () => api.get<SyncJobRow[]>("/api/sync-jobs") });
  let values = $state<Record<string, string | boolean>>({});
  let error = $state("");
  let otp = $state("");
  let otpForced = $state(false);
  let pendingSyncTarget = $state<SyncTarget>("default");
  const job = $derived(($jobs.data ?? []).find((j) => j.connectorId === connectorId && j.scope === "all"));
  const intervalOptions = [{ label: "每小時", minutes: 60 }, { label: "每 6 小時", minutes: 360 }, { label: "每 12 小時", minutes: 720 }, { label: "每天", minutes: 1440 }, { label: "每週", minutes: 10080 }];

  $effect(() => {
    for (const [key, value] of Object.entries($settings.data?.publicConfig ?? {})) {
      if (values[key] === undefined) values[key] = typeof value === "boolean" ? value : String(value);
    }
    if (connectorId === "einvoice" && values.fetchDetails === undefined) values.fetchDetails = true;
  });

  const save = createMutation({
    mutationFn: (config: Record<string, unknown>) => { if (!Object.keys(config).length) throw new Error("請先填寫欄位再儲存。"); return api.put(`/api/connectors/${connectorId}/settings`, { config }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connectorSettings(connectorId) }),
    onError: (e) => error = e instanceof Error ? e.message : "儲存失敗"
  });
  const updateJob = createMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/api/sync-jobs/${connectorId}/all`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.syncJobs })
  });
  const sync = createMutation({
    mutationFn: (target: SyncTarget) => {
      if (demoMode) throw new Error("Demo site 已停用連接器同步。");
      const path = connectorId === "tdcc" && target !== "default" ? `/api/connectors/${connectorId}/sync/${target}` : `/api/connectors/${connectorId}/sync`;
      pendingSyncTarget = target;
      return api.post(path, connectorId === "einvoice" ? { fetchDetails: true } : undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.syncJobs });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      if (connectorId === "einvoice") qc.invalidateQueries({ queryKey: queryKeys.invoices });
      else if (connectorId === "esun" || connectorId === "cathaybk") qc.invalidateQueries({ queryKey: queryKeys.bank });
      else {
        if (pendingSyncTarget === "default" || pendingSyncTarget === "investments") qc.invalidateQueries({ queryKey: queryKeys.investments });
        if (pendingSyncTarget === "default" || pendingSyncTarget === "trades") qc.invalidateQueries({ queryKey: queryKeys.investmentTransactions });
        if (pendingSyncTarget === "default" || pendingSyncTarget === "bank") qc.invalidateQueries({ queryKey: queryKeys.bank });
      }
    },
    onError: (e) => error = e instanceof Error ? e.message : "同步失敗"
  });
  const syncErrorMessage = $derived($sync.error instanceof Error ? $sync.error.message : "");
  const otpRequired = $derived(connectorId === "tdcc" && (otpForced || /OTP/i.test(syncErrorMessage)));
  const otpChannel = $derived(/SMS/i.test(syncErrorMessage) ? "sms" : "email");
  const verifyOtp = createMutation({
    mutationFn: () => {
      if (demoMode) throw new Error("Demo site 已停用連接器同步。");
      if (!otp.trim()) throw new Error("請先輸入驗證碼。");
      const path = connectorId === "tdcc" && pendingSyncTarget !== "default" ? `/api/connectors/${connectorId}/sync/${pendingSyncTarget}` : `/api/connectors/${connectorId}/sync`;
      return api.post(path, { otp: otp.trim(), otpChannel });
    },
    onSuccess: () => { otp = ""; otpForced = false; $sync.reset(); qc.invalidateQueries({ queryKey: queryKeys.connectorSettings(connectorId) }); qc.invalidateQueries({ queryKey: queryKeys.syncJobs }); qc.invalidateQueries({ queryKey: queryKeys.summary }); qc.invalidateQueries({ queryKey: queryKeys.investments }); qc.invalidateQueries({ queryKey: queryKeys.investmentTransactions }); qc.invalidateQueries({ queryKey: queryKeys.bank }); },
    onError: (e) => error = e instanceof Error ? e.message : "驗證失敗"
  });

  function buildConfig() {
    return Object.fromEntries(fields.map((f) => [f.key, f.type === "number" ? Number(values[f.key]) : values[f.key]]).filter(([, v]) => v !== undefined && v !== ""));
  }
  function scheduleTime(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    const [hours, minutes] = value.split(":").map(Number);
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    $updateJob.mutate({ nextRunAt: next.toISOString() });
  }
</script>

<article class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-lg font-semibold">{title}</h2>
      <p class="text-sm text-ink/65">{$settings.data?.configured ? `已設定於 ${formatDateTime($settings.data.updatedAt)}。機密資料不會在此顯示；重新填寫欄位即可覆寫。` : "尚未設定"}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={() => { error = ""; $save.mutate(buildConfig()); }}><Save class="size-4" />儲存</Button>
      {#if connectorId === "tdcc"}
        <Button size="sm" disabled={demoMode} onclick={() => $sync.mutate("investments")}><WalletCards class="size-4" />同步投資</Button>
        <Button size="sm" disabled={demoMode} onclick={() => $sync.mutate("bank")}><RefreshCw class="size-4" />同步銀行</Button>
        <Button size="sm" disabled={demoMode} onclick={() => $sync.mutate("trades")}><Database class="size-4" />同步交易</Button>
      {:else}
        <Button size="sm" disabled={demoMode} onclick={() => $sync.mutate("default")}><RefreshCw class="size-4" />同步</Button>
      {/if}
      {#if connectorId === "tdcc"}<Button size="sm" variant="secondary" disabled={demoMode} onclick={() => otpForced = true}><KeyRound class="size-4" />輸入 OTP</Button>{/if}
    </div>
  </div>
  {#if demoMode}<p class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Demo site 已停用同步；你仍可查看示範資料與介面互動。</p>{/if}
  {#if connectorId === "tdcc"}<details class="mt-3 rounded-md border border-ink/10 bg-paper text-sm text-ink/70" open><summary class="cursor-pointer select-none px-3 py-2 font-medium text-ink/80">使用說明</summary><ol class="list-decimal space-y-1.5 px-3 pb-3 pt-1 pl-8"><li>先在手機下載並登入「集保e存摺」，確認可看到股票與基金資料。</li><li>填入身分證字號與集保 App 密碼，儲存後再按同步。</li><li>首次同步需要驗證碼，請查看手機簡訊或電子信箱。</li><li>完成後即可看到持倉；日後同步通常不需重新輸入驗證碼。</li></ol></details>{/if}
  <div class="mt-3 rounded-md border border-ink/10 bg-paper px-3 py-2 text-sm text-ink/70">
    <div class="flex flex-wrap items-center justify-between gap-2"><div class="flex flex-wrap items-center gap-x-3 gap-y-1"><span class="font-medium">自動同步：{job?.enabled ? "開" : "關"}</span>{#if job}<span>狀態：{job.running ? "同步中" : job.lastStatus === "success" ? "正常" : job.lastStatus === "failed" ? "失敗" : job.lastStatus === "needs_user_action" ? "需要處理" : "尚未同步"}</span>{#if job.lastRunAt}<span>上次：{formatDateTime(job.lastRunAt)}</span>{/if}{#if job.enabled}<span class="flex items-center gap-1.5"><select class="rounded border border-ink/15 bg-white px-1 py-0.5 text-xs" value={intervalOptions.find((option) => option.minutes === job.intervalMinutes)?.minutes ?? 1440} onchange={(e) => $updateJob.mutate({ intervalMinutes: Number((e.currentTarget as HTMLSelectElement).value) })}>{#each intervalOptions as option}<option value={option.minutes}>{option.label}</option>{/each}</select>{#if job.intervalMinutes >= 1440 && job.nextRunAt}<input type="time" class="rounded border border-ink/15 bg-white px-1 py-0.5 text-xs" value={new Date(job.nextRunAt).toTimeString().slice(0, 5)} onchange={scheduleTime} /><span class="text-ink/50">同步</span>{/if}</span>{/if}{/if}</div>{#if job}<button class="rounded-md border border-ink/15 bg-white px-2.5 py-1 text-xs font-medium" disabled={$updateJob.isPending} onclick={() => $updateJob.mutate({ enabled: !job.enabled })}>{job.enabled ? "關閉" : "開啟"}</button>{/if}</div>
    {#if error || job?.lastError}<p class="mt-1 text-xs text-coral">{error ? `本次同步：${error}` : `上次同步：${job?.lastError}`}</p>{/if}
  </div>
  <div class="mt-4 grid gap-3">
    {#each fields as field}
      {#if field.type === "checkbox"}
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(values[field.key])} onchange={(e) => values[field.key] = (e.currentTarget as HTMLInputElement).checked} />{field.label}</label>
      {:else}
        <label class="grid gap-1 text-sm">{field.label}<input class="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm outline-hidden" type={field.type} placeholder={field.placeholder} bind:value={values[field.key]} /></label>
      {/if}
    {/each}
  </div>
  {#if otpRequired}<div class="mt-3 rounded-md border border-coral/40 bg-coral/10 p-3"><p class="text-sm font-medium text-ink/80">TDCC 需要驗證碼，請查看{otpChannel === "sms" ? "手機簡訊" : "電子信箱"}。</p><div class="mt-2 flex flex-wrap gap-2"><input class="min-w-40 flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-hidden" placeholder="輸入驗證碼" bind:value={otp} /><Button size="sm" disabled={$verifyOtp.isPending} onclick={() => $verifyOtp.mutate()}><RefreshCw class="size-4" />驗證並同步</Button></div></div>{/if}
  {#if error}<p class="mt-3 rounded-md bg-paper px-3 py-2 text-sm text-coral">{error}</p>{/if}
  <p class="mt-3 text-xs text-ink/50">輸入完帳號密碼後，請先按「儲存設定」，再按「同步」。</p>
</article>
