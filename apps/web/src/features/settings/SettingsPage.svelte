<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { ShieldCheck } from "@lucide/svelte";
  import type { ApiClient } from "@/shared/api/client";
  import type { MobileSettingsView, View } from "@/app/types";
  import { bankQuery } from "@/data/bank/queries";
  import { classificationRulesQuery } from "@/data/classification/queries";
  import {
    connectorDefinitions,
    connectorFields,
  } from "@/data/connectors/definitions";
  import { syncJobsQuery } from "@/data/connectors/queries";
  import type { ConnectorId } from "@/data/connectors/types";
  import ClassificationRulesPanel from "./components/ClassificationRulesPanel.svelte";
  import DefaultSchedulePanel from "./components/DefaultSchedulePanel.svelte";
  import ExchangeRatesPanel from "./components/ExchangeRatesPanel.svelte";
  import Metric from "./components/Metric.svelte";
  import MobileMore from "./components/MobileMore.svelte";
  import SourceCard from "./components/SourceCard.svelte";
  import ConnectorPanel from "./connectors/ConnectorPanel.svelte";
  let {
    api,
    demoMode,
    mobileView,
    navigate,
  }: {
    api: ApiClient;
    demoMode: boolean;
    mobileView?: MobileSettingsView | "more";
    navigate: (view: View) => void;
  } = $props();
  const sources = connectorDefinitions;
  const jobs = createQuery(syncJobsQuery(() => api));
  const rules = createQuery(classificationRulesQuery(() => api));
  const bank = createQuery(bankQuery(() => api));
  let selectedConnector = $state<ConnectorId | null>(null);
  const enabledJobs = $derived(
    ($jobs.data ?? []).filter((j) => j.enabled).length,
  );
  const needsAction = $derived(
    ($jobs.data ?? []).filter(
      (j) => j.lastStatus === "failed" || j.lastStatus === "needs_user_action",
    ).length,
  );
  function selectConnector(id: ConnectorId) {
    selectedConnector = selectedConnector === id ? null : id;
  }
</script>

{#if mobileView === "more"}
  <MobileMore
    {demoMode}
    jobs={$jobs.data ?? []}
    rules={$rules.data ?? []}
    bank={$bank.data ?? { accounts: [], transactions: [] }}
    {navigate}
    {api}
  />
{:else if mobileView === "data-sources"}
  <div class="grid gap-4">
    <DefaultSchedulePanel {api} {demoMode} jobs={$jobs.data ?? []} />
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {#each sources as source (source.id)}
        <SourceCard
          {api}
          {...source}
          id={source.id}
          jobs={$jobs.data ?? []}
          selected={selectedConnector === source.id}
          onConfigure={() => selectConnector(source.id)}
        >
          {#if selectedConnector === source.id}
            {#key source.id}<ConnectorPanel
                {api}
                connectorId={source.id}
                {demoMode}
                title={source.title}
                fields={connectorFields[source.id]}
                embedded
              />{/key}
          {/if}
        </SourceCard>
      {/each}
    </div>
  </div>
{:else if mobileView === "exchange-rates"}<ExchangeRatesPanel {api} />
{:else if mobileView === "classification-rules"}<ClassificationRulesPanel
    {api}
  />
{:else}
  <div class="grid gap-5">
    <section class="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <Metric
        label="資料來源"
        value={String(sources.length)}
        detail="支援的連接器"
      /><Metric
        label="同步排程"
        value={String(enabledJobs)}
        detail="已啟用"
        tone={enabledJobs ? "positive" : "neutral"}
      /><Metric
        label="分類規則"
        value={String($rules.data?.length ?? 0)}
        detail="銀行交易"
      /><Metric
        label="需要處理"
        value={String(needsAction)}
        detail="同步或驗證狀態"
        tone={needsAction ? "negative" : "positive"}
      />
    </section>

    <DefaultSchedulePanel {api} {demoMode} jobs={$jobs.data ?? []} />

    <section
      aria-label="資料來源"
      class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
    >
      {#each sources as source (source.id)}
        <SourceCard
          {api}
          {...source}
          id={source.id}
          jobs={$jobs.data ?? []}
          selected={selectedConnector === source.id}
          onConfigure={() => selectConnector(source.id)}
        >
          {#if selectedConnector === source.id}
            {#key source.id}<ConnectorPanel
                {api}
                connectorId={source.id}
                {demoMode}
                title={source.title}
                fields={connectorFields[source.id]}
                embedded
              />{/key}
          {/if}
        </SourceCard>
      {/each}
    </section>

    <section
      class="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
    >
      <div class="grid gap-5">
        <ExchangeRatesPanel {api} />
        <aside
          class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs"
        >
          <div class="flex items-start gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-moss/10 text-moss"
            >
              <ShieldCheck class="size-5" />
            </span>
            <div>
              <h2 class="font-semibold">資料安全</h2>
              <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
                連接器憑證僅用於個人資料同步，機密欄位會加密保存，且不會重新顯示在設定頁。
              </p>
            </div>
          </div>
        </aside>
      </div>
      <ClassificationRulesPanel {api} />
    </section>
  </div>
{/if}
