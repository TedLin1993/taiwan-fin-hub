<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { ShieldCheck } from "@lucide/svelte";
  import type { ApiClient } from "../../lib/api";
  import {
    bankQuery,
    classificationRulesQuery,
    syncJobsQuery,
  } from "../../lib/queries";
  import type {
    ConnectorField,
    ConnectorId,
    MobileSettingsView,
    View,
  } from "../../lib/types";
  import Metric from "./Metric.svelte";
  import SourceCard from "./SourceCard.svelte";
  import ExchangeRatesPanel from "./ExchangeRatesPanel.svelte";
  import ClassificationRulesPanel from "./ClassificationRulesPanel.svelte";
  import ConnectorPanel from "./ConnectorPanel.svelte";
  import MobileMore from "./MobileMore.svelte";
  import DefaultSchedulePanel from "./DefaultSchedulePanel.svelte";
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
  const sources: { id: ConnectorId; title: string; description: string }[] = [
    { id: "einvoice", title: "電子發票", description: "財政部載具與品項明細" },
    {
      id: "tdcc",
      title: "集保 e 存摺",
      description: "持倉、投資交易與銀行帳戶",
    },
    { id: "esun", title: "玉山銀行", description: "帳戶、信用卡與交易" },
    { id: "cathaybk", title: "國泰世華銀行", description: "帳戶與交易" },
    {
      id: "sinopac",
      title: "永豐行動銀行",
      description: "信用卡帳務、近期帳單與消費",
    },
  ];
  const connectorFields: Record<ConnectorId, ConnectorField[]> = {
    einvoice: [
      {
        key: "mobile",
        label: "手機號碼（電子發票帳號）",
        type: "text",
      },
      {
        key: "password",
        label: "電子發票 App 登入密碼",
        type: "password",
      },
      {
        key: "periodsBack",
        label: "往回期數",
        type: "number",
        placeholder: "6",
      },
      { key: "fetchDetails", label: "同步品項明細", type: "checkbox" },
    ],
    tdcc: [
      { key: "identity", label: "身分證字號", type: "text" },
      { key: "password", label: "集保 App 密碼", type: "password" },
    ],
    esun: [
      { key: "username", label: "使用者名稱", type: "text" },
      { key: "password", label: "密碼", type: "password" },
      {
        key: "lookbackMonths",
        label: "往回月份",
        type: "number",
        placeholder: "3",
      },
    ],
    cathaybk: [
      { key: "username", label: "使用者名稱", type: "text" },
      { key: "password", label: "密碼", type: "password" },
      {
        key: "lookbackMonths",
        label: "往回月份",
        type: "number",
        placeholder: "3",
      },
    ],
    sinopac: [
      { key: "userId", label: "身分證字號／統編", type: "text" },
      { key: "account", label: "行動／網路銀行使用者代碼", type: "text" },
      { key: "password", label: "網路密碼", type: "password" },
      {
        key: "lookbackMonths",
        label: "帳單往回月份",
        type: "number",
        placeholder: "3",
      },
    ],
  };
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
