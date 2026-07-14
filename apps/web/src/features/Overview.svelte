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
  import NetWorthHistoryChart from "./NetWorthHistoryChart.svelte";

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
  const bankData = $derived($bank.data ?? { accounts: [], transactions: [] });
  const rateValues = $derived(rateMap($rates.data));
  const deposits = $derived(bankData.accounts.filter((a) => a.accountType !== "credit"));
  const bankGroups = $derived.by(() => {
    const grouped = new Map<string, typeof deposits>();
    for (const account of deposits) {
      const institution = account.institutionName ?? account.connectorId;
      grouped.set(institution, [...(grouped.get(institution) ?? []), account]);
    }

    return [...grouped.entries()].map(([institution, accounts]) => {
      const currencyTotals = Object.entries(accounts.reduce<Record<string, number>>((totals, account) => {
        const currency = account.currency || "TWD";
        totals[currency] = (totals[currency] ?? 0) + (account.balance ?? 0);
        return totals;
      }, {})).sort((a, b) => {
        const aTwd = a[1] * (a[0] === "TWD" ? 1 : rateValues[a[0]] ?? 0);
        const bTwd = b[1] * (b[0] === "TWD" ? 1 : rateValues[b[0]] ?? 0);
        return bTwd - aTwd;
      });
      const totalTwd = accounts.reduce((sum, account) => sum + (account.balance ?? 0) * (account.currency === "TWD" ? 1 : rateValues[account.currency] ?? 0), 0);
      const lastUpdated = accounts.reduce((latest, account) => account.asOfAt && account.asOfAt > latest ? account.asOfAt : latest, "");
      return { institution, accounts, currencyTotals, totalTwd, lastUpdated };
    }).sort((a, b) => b.totalTwd - a.totalTwd || a.institution.localeCompare(b.institution, "zh-TW"));
  });
  const totalDeposits = $derived(deposits.reduce((sum, a) => sum + (a.currency === "TWD" ? (a.balance ?? 0) : (a.balance ?? 0) * (rateValues[a.currency] ?? 0)), 0));
  const totalManual = $derived(($manualAssets.data ?? []).reduce((sum, a) => sum + (a.value ?? 0), 0));
  const total = $derived(totalDeposits + ($summary.data?.totalInvestmentValue ?? 0) + (includeManual ? totalManual : 0));
  const recent = $derived([...bankData.transactions].sort((a, b) => (b.postedDate ?? b.authorizedAt ?? "").localeCompare(a.postedDate ?? a.authorizedAt ?? "")).slice(0, 6));
  const unhealthy = $derived(($jobs.data ?? []).filter((j) => j.lastStatus === "failed" || j.lastStatus === "needs_user_action"));
  const missingRates = $derived([...new Set(deposits.map((a) => a.currency).filter((c) => c !== "TWD" && !rateValues[c]))]);
  const loading = $derived($summary.isPending || $bank.isPending || $investments.isPending || $manualAssets.isPending);
  const failed = $derived($summary.isError || $bank.isError || $investments.isError || $manualAssets.isError);

  onMount(() => {
    includeManual = localStorage.getItem("taiwan-fin-hub-total-assets-scope") !== "financial";
  });
  function toggleManual(value: boolean) { includeManual = value; localStorage.setItem("taiwan-fin-hub-total-assets-scope", value ? "all" : "financial"); }
</script>

{#if loading}
  <EmptyState title="載入總覽中" body="正在讀取最新本機紀錄。" />
{:else if failed}
  <EmptyState title="無法載入總覽" body="請稍後再試，或確認 Worker API 是否可用。" />
{:else}
  <div class="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-6">
    {#if missingRates.length}<div class="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>帳戶含外幣（{missingRates.join("、")}）尚未設定匯率，TWD 總額可能不準確。</span><button class="shrink-0 font-medium underline underline-offset-2" onclick={() => navigate("settings")}>前往設定</button></div>{/if}
    <section class="rounded-xl border border-ink/10 bg-white p-6 shadow-xs">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p class="text-sm font-medium text-ink/50">總資產</p><p class="mt-1 text-4xl font-bold tracking-tight">{formatCurrency(total)}</p><p class="mt-2 text-xs text-ink/45">銀行、投資{includeManual ? "與其他資產" : ""}換算為 TWD</p></div><div class="inline-flex w-fit rounded-lg border border-ink/10 bg-ink/3 p-1 text-xs font-medium">{#each [{label:"流動資產",include:false},{label:"全部資產",include:true}] as option}<button class={`rounded-md px-3 py-1.5 transition ${includeManual === option.include ? "bg-white text-ink shadow-xs" : "text-ink/55"}`} onclick={() => toggleManual(option.include)}>{option.label}</button>{/each}</div></div>
      <div class="mt-6 grid gap-3 sm:grid-cols-3"><div class="rounded-xl bg-steel/10 p-4"><p class="text-xs text-ink/50">銀行與現金</p><p class="mt-2 text-xl font-bold">{formatCurrency(totalDeposits)}</p><button class="mt-2 text-xs font-semibold text-steel" onclick={() => navigate("bank")}>查看帳戶 →</button></div><div class="rounded-xl bg-ink/5 p-4"><p class="text-xs text-ink/50">投資</p><p class="mt-2 text-xl font-bold">{formatCurrency($summary.data?.totalInvestmentValue ?? 0)}</p><button class="mt-2 text-xs font-semibold text-steel" onclick={() => navigate("investments")}>查看持倉 →</button></div><div class="rounded-xl bg-moss/10 p-4"><p class="text-xs text-ink/50">其他資產</p><p class="mt-2 text-xl font-bold">{formatCurrency(totalManual)}</p><button class="mt-2 text-xs font-semibold text-steel" onclick={() => navigate("manual-assets")}>更新估值 →</button></div></div>
    </section>
    <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <Card class="min-w-0 overflow-hidden"><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><Building2 class="size-4 text-steel" />各銀行餘額</h2><button class="text-xs font-semibold text-steel" onclick={() => navigate("bank")}>查看全部 →</button></CardHeader><CardContent class="p-0">{#if bankGroups.length === 0}<p class="px-5 py-8 text-center text-sm text-ink/50">同步銀行連接器後顯示餘額。</p>{:else}<div class="divide-y divide-ink/8">{#each bankGroups.slice(0, 8) as group}<div class="px-5 py-3.5"><div class="flex min-w-0 items-start justify-between gap-3"><div class="min-w-0"><p class="truncate font-medium">{group.institution}</p><p class="mt-0.5 text-xs text-ink/45">{group.accounts.length} 個帳戶{group.lastUpdated ? ` · ${formatDate(group.lastUpdated)}` : ""}</p></div>{#if group.currencyTotals.length === 1}<p class="shrink-0 font-semibold tabular-nums">{formatCurrency(group.currencyTotals[0]![1], group.currencyTotals[0]![0])}</p>{/if}</div>{#if group.currencyTotals.length > 1}<div class="mt-2 grid gap-1 border-l-2 border-ink/8 pl-3">{#each group.currencyTotals as [currency, amount]}<div class="flex items-center justify-between gap-3"><span class="text-xs font-medium text-ink/50">{currency}</span><span class="text-sm font-semibold tabular-nums">{formatCurrency(amount, currency)}</span></div>{/each}</div>{/if}</div>{/each}</div>{/if}</CardContent></Card>
      <Card><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><TrendingUp class="size-4 text-steel" />最新銀行交易</h2><button class="text-xs font-semibold text-steel" onclick={() => navigate("activity")}>查看活動 →</button></CardHeader><CardContent>{#if recent.length === 0}<p class="py-8 text-center text-sm text-ink/50">同步銀行連接器後顯示交易。</p>{:else}<div class="divide-y divide-ink/8">{#each recent as txn}<div class="flex items-center gap-3 py-3"><span class={`flex size-8 shrink-0 items-center justify-center rounded-full ${txn.amount >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>{#if txn.amount >= 0}<ArrowDownLeft class="size-4" />{:else}<ArrowUpRight class="size-4" />{/if}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{txn.description ?? txn.counterparty ?? "交易"}</p><p class="text-xs text-ink/45">{txn.institutionName ?? "銀行"} · {formatDate(txn.postedDate ?? txn.authorizedAt)}</p></div><p class={`shrink-0 text-sm font-semibold tabular-nums ${txn.amount >= 0 ? "text-moss" : "text-coral"}`}>{txn.amount >= 0 ? "+" : ""}{formatCurrency(txn.amount, txn.currency)}</p></div>{/each}</div>{/if}</CardContent></Card>
    </div>
    <Card><CardHeader class="flex-row items-center justify-between"><h2 class="text-lg font-semibold">同步健康度</h2><span class={`rounded-full px-3 py-1 text-xs font-semibold ${unhealthy.length ? "bg-coral/10 text-coral" : "bg-moss/10 text-moss"}`}>{unhealthy.length ? `${unhealthy.length} 個來源需要處理` : "所有來源同步正常"}</span></CardHeader><CardContent><div class="grid gap-3 sm:grid-cols-3"><div><p class="text-xs text-ink/45">資料來源</p><p class="mt-1 text-2xl font-bold">4</p></div><div><p class="text-xs text-ink/45">投資持倉</p><p class="mt-1 text-2xl font-bold">{$summary.data?.investmentCount ?? 0}</p></div><div><p class="text-xs text-ink/45">近期投資交易</p><p class="mt-1 text-2xl font-bold">{$trades.data?.length ?? 0}</p></div></div></CardContent></Card>
    <NetWorthHistoryChart data={$history.data ?? []} loading={$history.isPending} />
  </div>
{/if}
