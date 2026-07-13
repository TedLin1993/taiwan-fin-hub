<script lang="ts">
  import { onMount } from "svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import { ArrowDownLeft, ArrowUpRight, Building2, TrendingUp, WalletCards } from "@lucide/svelte";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { BankData, ExchangeRateRow, InvestmentRow, InvestmentTransactionRow, ManualAssetRow, NetWorthHistoryRow, Summary, SyncJobRow, View } from "../lib/types";
  import { formatCurrency, formatDate, formatDateTime, rateMap } from "../lib/format.svelte";

  let { api, navigate }: { api: ApiClient; navigate: (view: View) => void } = $props();
  const summary = createQuery<Summary>({ queryKey: queryKeys.summary, queryFn: () => api.get<Summary>("/api/summary") });
  const bank = createQuery<BankData>({ queryKey: queryKeys.bank, queryFn: () => api.get<BankData>("/api/bank") });
  const investments = createQuery<InvestmentRow[]>({ queryKey: queryKeys.investments, queryFn: () => api.get<InvestmentRow[]>("/api/investments") });
  const trades = createQuery<InvestmentTransactionRow[]>({ queryKey: queryKeys.investmentTransactions, queryFn: () => api.get<InvestmentTransactionRow[]>("/api/investment-transactions") });
  const manualAssets = createQuery<ManualAssetRow[]>({ queryKey: queryKeys.manualAssets, queryFn: () => api.get<ManualAssetRow[]>("/api/manual-assets") });
  const rates = createQuery<ExchangeRateRow[]>({ queryKey: queryKeys.exchangeRates, queryFn: () => api.get<ExchangeRateRow[]>("/api/exchange-rates") });
  const jobs = createQuery<SyncJobRow[]>({ queryKey: queryKeys.syncJobs, queryFn: () => api.get<SyncJobRow[]>("/api/sync-jobs") });
  const history = createQuery<NetWorthHistoryRow[]>({ queryKey: queryKeys.netWorthHistory, queryFn: () => api.get<NetWorthHistoryRow[]>("/api/history/net-worth") });
  let includeManual = $state(true);
  type IncludedAsset = "stock" | "fund" | "deposit" | "manual";
  const defaultIncludedAssets: IncludedAsset[] = ["stock", "fund", "deposit"];
  let includedAssets = $state<IncludedAsset[]>(defaultIncludedAssets);
  const bankData = $derived($bank.data ?? { accounts: [], transactions: [] });
  const rateValues = $derived(rateMap($rates.data));
  const deposits = $derived(bankData.accounts.filter((a) => a.accountType !== "credit"));
  const totalDeposits = $derived(deposits.reduce((sum, a) => sum + (a.currency === "TWD" ? (a.balance ?? 0) : (a.balance ?? 0) * (rateValues[a.currency] ?? 0)), 0));
  const totalManual = $derived(($manualAssets.data ?? []).reduce((sum, a) => sum + (a.value ?? 0), 0));
  const total = $derived(totalDeposits + ($summary.data?.totalInvestmentValue ?? 0) + (includeManual ? totalManual : 0));
  const recent = $derived([...bankData.transactions].sort((a, b) => (b.postedDate ?? b.authorizedAt ?? "").localeCompare(a.postedDate ?? a.authorizedAt ?? "")).slice(0, 6));
  const unhealthy = $derived(($jobs.data ?? []).filter((j) => j.lastStatus === "failed" || j.lastStatus === "needs_user_action"));
  const missingRates = $derived([...new Set(deposits.map((a) => a.currency).filter((c) => c !== "TWD" && !rateValues[c]))]);
  const loading = $derived($summary.isPending || $bank.isPending || $investments.isPending || $manualAssets.isPending);
  const failed = $derived($summary.isError || $bank.isError || $investments.isError || $manualAssets.isError);
  const historyRows = $derived(($history.data ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-12));
  const historyMax = $derived(Math.max(...historyRows.map((row) => row.netWorth), 1));

  onMount(() => {
    includeManual = localStorage.getItem("taiwan-fin-hub-total-assets-scope") !== "financial";
    try {
      const saved = JSON.parse(localStorage.getItem("taiwan-fin-hub-net-worth-chart-included-assets") ?? "null");
      if (Array.isArray(saved)) {
        const valid = saved.filter((value): value is IncludedAsset => ["stock", "fund", "deposit", "manual"].includes(value));
        if (valid.length) includedAssets = valid;
      }
    } catch { /* use defaults */ }
  });
  function toggleManual(value: boolean) { includeManual = value; localStorage.setItem("taiwan-fin-hub-total-assets-scope", value ? "all" : "financial"); }
  function toggleIncludedAsset(value: IncludedAsset) {
    const next = includedAssets.includes(value) ? includedAssets.filter((item) => item !== value) : [...includedAssets, value];
    if (next.length) { includedAssets = next; localStorage.setItem("taiwan-fin-hub-net-worth-chart-included-assets", JSON.stringify(next)); }
  }
</script>

{#if loading}
  <EmptyState title="載入總覽中" body="正在讀取最新本機紀錄。" />
{:else if failed}
  <EmptyState title="無法載入總覽" body="請稍後再試，或確認 Worker API 是否可用。" />
{:else}
  <div class="grid gap-6">
    {#if missingRates.length}<div class="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>帳戶含外幣（{missingRates.join("、")}）尚未設定匯率，TWD 總額可能不準確。</span><button class="shrink-0 font-medium underline underline-offset-2" onclick={() => navigate("settings")}>前往設定</button></div>{/if}
    <section class="rounded-xl border border-ink/10 bg-white p-6 shadow-xs">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p class="text-sm font-medium text-ink/50">總資產</p><p class="mt-1 text-4xl font-bold tracking-tight">{formatCurrency(total)}</p><p class="mt-2 text-xs text-ink/45">銀行、投資{includeManual ? "與其他資產" : ""}換算為 TWD</p></div><div class="inline-flex w-fit rounded-lg border border-ink/10 bg-ink/3 p-1 text-xs font-medium">{#each [{label:"流動資產",include:false},{label:"全部資產",include:true}] as option}<button class={`rounded-md px-3 py-1.5 transition ${includeManual === option.include ? "bg-white text-ink shadow-xs" : "text-ink/55"}`} onclick={() => toggleManual(option.include)}>{option.label}</button>{/each}</div></div>
      <div class="mt-6 grid gap-3 sm:grid-cols-3"><div class="rounded-xl bg-steel/10 p-4"><p class="text-xs text-ink/50">銀行與現金</p><p class="mt-2 text-xl font-bold">{formatCurrency(totalDeposits)}</p><button class="mt-2 text-xs font-semibold text-steel" onclick={() => navigate("bank")}>查看帳戶 →</button></div><div class="rounded-xl bg-ink/5 p-4"><p class="text-xs text-ink/50">投資</p><p class="mt-2 text-xl font-bold">{formatCurrency($summary.data?.totalInvestmentValue ?? 0)}</p><button class="mt-2 text-xs font-semibold text-steel" onclick={() => navigate("investments")}>查看持倉 →</button></div><div class="rounded-xl bg-moss/10 p-4"><p class="text-xs text-ink/50">其他資產</p><p class="mt-2 text-xl font-bold">{formatCurrency(totalManual)}</p><button class="mt-2 text-xs font-semibold text-steel" onclick={() => navigate("manual-assets")}>更新估值 →</button></div></div>
    </section>
    <div class="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><Building2 class="size-4 text-steel" />各銀行餘額</h2><button class="text-xs font-semibold text-steel" onclick={() => navigate("bank")}>查看全部 →</button></CardHeader><CardContent>{#if deposits.length === 0}<p class="py-8 text-center text-sm text-ink/50">同步銀行連接器後顯示餘額。</p>{:else}<div class="divide-y divide-ink/8">{#each deposits.slice(0, 8) as account}<div class="flex items-center justify-between gap-3 py-3"><div class="min-w-0"><p class="truncate font-medium">{account.institutionName ?? account.connectorId}</p><p class="text-xs text-ink/45">{account.accountName ?? account.currency}{account.asOfAt ? ` · ${formatDate(account.asOfAt)}` : ""}</p></div><p class="shrink-0 font-semibold tabular-nums">{formatCurrency(account.balance ?? 0, account.currency)}</p></div>{/each}</div>{/if}</CardContent></Card>
      <Card><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><TrendingUp class="size-4 text-steel" />最新銀行交易</h2><button class="text-xs font-semibold text-steel" onclick={() => navigate("activity")}>查看活動 →</button></CardHeader><CardContent>{#if recent.length === 0}<p class="py-8 text-center text-sm text-ink/50">同步銀行連接器後顯示交易。</p>{:else}<div class="divide-y divide-ink/8">{#each recent as txn}<div class="flex items-center gap-3 py-3"><span class={`flex size-8 shrink-0 items-center justify-center rounded-full ${txn.amount >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>{#if txn.amount >= 0}<ArrowDownLeft class="size-4" />{:else}<ArrowUpRight class="size-4" />{/if}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{txn.description ?? txn.counterparty ?? "交易"}</p><p class="text-xs text-ink/45">{txn.institutionName ?? "銀行"} · {formatDate(txn.postedDate ?? txn.authorizedAt)}</p></div><p class={`shrink-0 text-sm font-semibold tabular-nums ${txn.amount >= 0 ? "text-moss" : "text-coral"}`}>{txn.amount >= 0 ? "+" : ""}{formatCurrency(txn.amount, txn.currency)}</p></div>{/each}</div>{/if}</CardContent></Card>
    </div>
    <Card><CardHeader class="flex-row items-center justify-between"><h2 class="text-lg font-semibold">同步健康度</h2><span class={`rounded-full px-3 py-1 text-xs font-semibold ${unhealthy.length ? "bg-coral/10 text-coral" : "bg-moss/10 text-moss"}`}>{unhealthy.length ? `${unhealthy.length} 個來源需要處理` : "所有來源同步正常"}</span></CardHeader><CardContent><div class="grid gap-3 sm:grid-cols-3"><div><p class="text-xs text-ink/45">資料來源</p><p class="mt-1 text-2xl font-bold">4</p></div><div><p class="text-xs text-ink/45">投資持倉</p><p class="mt-1 text-2xl font-bold">{$summary.data?.investmentCount ?? 0}</p></div><div><p class="text-xs text-ink/45">近期投資交易</p><p class="mt-1 text-2xl font-bold">{$trades.data?.length ?? 0}</p></div></div></CardContent></Card>
    <Card><CardHeader class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-semibold">淨資產趨勢</h2><div class="flex flex-wrap gap-1">{#each [{ key: "stock", label: "股票/ETF" }, { key: "fund", label: "基金" }, { key: "deposit", label: "存款" }, { key: "manual", label: "其他" }] as option}<button class={`rounded-md px-2 py-1 text-xs ${includedAssets.includes(option.key as IncludedAsset) ? "bg-steel/15 text-steel" : "bg-ink/5 text-ink/45"}`} onclick={() => toggleIncludedAsset(option.key as IncludedAsset)}>{option.label}</button>{/each}</div></CardHeader><CardContent>{#if $history.isPending}<p class="py-6 text-center text-sm text-ink/45">載入趨勢中…</p>{:else if historyRows.length === 0}<p class="py-6 text-center text-sm text-ink/45">尚無淨資產歷史資料。</p>{:else}<div class="grid gap-2">{#each historyRows as row}<div class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs"><span class="text-ink/45">{formatDate(row.date)}</span><div class="h-2 overflow-hidden rounded-full bg-ink/8"><span class="block h-full rounded-full bg-steel" style={`width: ${Math.max(2, Math.min(100, row.netWorth / historyMax * 100))}%`}></span></div><span class="font-medium tabular-nums">{formatCurrency(row.netWorth)}</span></div>{/each}</div>{/if}</CardContent></Card>
  </div>
{/if}
