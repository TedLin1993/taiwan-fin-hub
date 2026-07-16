<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import type { ApiClient } from "../../lib/api";
  import { bankQuery, classificationRulesQuery, syncJobsQuery } from "../../lib/queries";
  import type { ConnectorField, ConnectorId, MobileSettingsView, View } from "../../lib/types";
  import Metric from "./Metric.svelte";
  import SourceCard from "./SourceCard.svelte";
  import ExchangeRatesPanel from "./ExchangeRatesPanel.svelte";
  import ClassificationRulesPanel from "./ClassificationRulesPanel.svelte";
  import ConnectorPanel from "./ConnectorPanel.svelte";
  import MobileMore from "./MobileMore.svelte";
  let { api, demoMode, mobileView, navigate }: { api: ApiClient; demoMode: boolean; mobileView?: MobileSettingsView | "more"; navigate: (view: View) => void } = $props();
  const sources: { id: ConnectorId; title: string; description: string }[] = [{ id: "einvoice", title: "電子發票", description: "財政部載具與品項明細" }, { id: "tdcc", title: "集保 e 存摺", description: "持倉、投資交易與銀行帳戶" }, { id: "esun", title: "玉山銀行", description: "帳戶、信用卡與交易" }, { id: "cathaybk", title: "國泰世華銀行", description: "帳戶與交易" }, { id: "sinopac", title: "永豐行動銀行", description: "App JSON API：信用卡帳務、近期帳單與未出帳消費" }];
  const connectorFields: Record<ConnectorId, ConnectorField[]> = {
    einvoice: [{ key: "appId", label: "App ID", type: "text" }, { key: "apiKey", label: "API Key", type: "password" }, { key: "periodsBack", label: "往回期數", type: "number", placeholder: "6" }, { key: "fetchDetails", label: "同步品項明細", type: "checkbox" }],
    tdcc: [{ key: "identity", label: "身分證字號", type: "text" }, { key: "password", label: "集保 App 密碼", type: "password" }],
    esun: [{ key: "username", label: "使用者名稱", type: "text" }, { key: "password", label: "密碼", type: "password" }, { key: "lookbackMonths", label: "往回月份", type: "number", placeholder: "3" }],
    cathaybk: [{ key: "username", label: "使用者名稱", type: "text" }, { key: "password", label: "密碼", type: "password" }, { key: "lookbackMonths", label: "往回月份", type: "number", placeholder: "3" }],
    sinopac: [{ key: "userId", label: "身分證字號／統編", type: "text" }, { key: "account", label: "行動／網路銀行使用者代碼", type: "text" }, { key: "password", label: "網路密碼", type: "password" }, { key: "lookbackMonths", label: "帳單往回月份", type: "number", placeholder: "3" }]
  };
  const jobs = createQuery(syncJobsQuery(() => api));
  const rules = createQuery(classificationRulesQuery(() => api));
  const bank = createQuery(bankQuery(() => api));
  let selectedConnector = $state<ConnectorId | null>(null);
  const enabledJobs = $derived(($jobs.data ?? []).filter((j) => j.enabled).length);
  const needsAction = $derived(($jobs.data ?? []).filter((j) => j.lastStatus === "failed" || j.lastStatus === "needs_user_action").length);
  function selectConnector(id: ConnectorId) { selectedConnector = selectedConnector === id ? null : id; }
</script>

{#if mobileView === "more"}
  <MobileMore demoMode={demoMode} jobs={$jobs.data ?? []} rules={$rules.data ?? []} bank={$bank.data ?? { accounts: [], transactions: [] }} {navigate} api={api} />
{:else if mobileView === "data-sources"}
  <div class="grid gap-3">{#each sources as source (source.id)}<SourceCard {api} {...source} id={source.id} jobs={$jobs.data ?? []} selected={selectedConnector === source.id} onConfigure={() => selectConnector(source.id)} />{/each}{#if selectedConnector}{#key selectedConnector}<ConnectorPanel {api} connectorId={selectedConnector} demoMode={demoMode} title={sources.find((s) => s.id === selectedConnector)?.title ?? selectedConnector} fields={connectorFields[selectedConnector]} />{/key}{/if}</div>
{:else if mobileView === "exchange-rates"}<ExchangeRatesPanel {api} />
{:else if mobileView === "classification-rules"}<ClassificationRulesPanel {api} />
{:else}
  <div class="grid gap-5"><div class="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"><Metric label="已設定來源" value={String(sources.length)} detail="資料連接器" /><Metric label="同步排程" value={String(enabledJobs)} detail="已啟用" /><Metric label="分類規則" value={String($rules.data?.length ?? 0)} detail="銀行交易" /><Metric label="需要處理" value={String(needsAction)} detail="同步狀態" tone={needsAction ? "negative" : "positive"} /></div><section class="grid gap-3 md:grid-cols-2">{#each sources as source (source.id)}<SourceCard {api} {...source} id={source.id} jobs={$jobs.data ?? []} selected={selectedConnector === source.id} onConfigure={() => selectConnector(source.id)} />{/each}</section>{#if selectedConnector}{#key selectedConnector}<ConnectorPanel {api} connectorId={selectedConnector} demoMode={demoMode} title={sources.find((s) => s.id === selectedConnector)?.title ?? selectedConnector} fields={connectorFields[selectedConnector]} />{/key}{/if}<section class="grid gap-5"><ExchangeRatesPanel {api} /><ClassificationRulesPanel {api} /></section></div>
{/if}
