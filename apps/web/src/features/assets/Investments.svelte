<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { Search } from "@lucide/svelte";
  import Card from "../../components/ui/Card.svelte";
  import CardHeader from "../../components/ui/CardHeader.svelte";
  import CardContent from "../../components/ui/CardContent.svelte";
  import EmptyState from "../../components/ui/EmptyState.svelte";
  import Input from "../../components/ui/Input.svelte";
  import Select from "../../components/ui/Select.svelte";
  import InvestmentPerformanceChart from "./InvestmentPerformanceChart.svelte";
  import type { ApiClient } from "../../lib/api";
  import {
    exchangeRatesQuery,
    investmentPerformanceQuery,
    investmentsQuery,
    investmentTransactionsQuery,
  } from "../../lib/queries";
  import type { InvestmentTransactionRow } from "../../lib/types";
  import {
    formatCurrency,
    formatDate,
    formatNumber,
    rateMap,
  } from "../../lib/format.svelte";
  let { api }: { api: ApiClient } = $props();
  const investments = createQuery(investmentsQuery(() => api));
  const performance = createQuery(investmentPerformanceQuery(() => api));
  const trades = createQuery(investmentTransactionsQuery(() => api));
  const rates = createQuery(exchangeRatesQuery(() => api));
  let search = $state("");
  let tradeType = $state("all");
  const positions = $derived(
    ($investments.data ?? []).filter((p) =>
      `${p.symbol ?? ""} ${p.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  const rateValues = $derived(rateMap($rates.data));
  const total = $derived(
    ($investments.data ?? []).reduce((s, p) => {
      const value = (p.marketValue ?? 0) + (p.cashBalance ?? 0);
      return (
        s +
        (p.currency === "TWD" ? value : value * (rateValues[p.currency] ?? 0))
      );
    }, 0),
  );
  const filteredTrades = $derived(
    ($trades.data ?? [])
      .filter(
        (t) =>
          (tradeType === "all" || t.assetType === tradeType) &&
          `${t.symbol ?? ""} ${t.name ?? ""} ${t.transactionName ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
      .slice(0, 100),
  );
  const unrealizedByPosition = $derived(
    new Map(
      ($performance.data?.positions ?? []).map((position) => [
        position.positionId,
        position,
      ]),
    ),
  );
  const currentProfitLoss = $derived(
    $performance.data?.currentProfitLoss ?? null,
  );
  function tradeDisplay(t: InvestmentTransactionRow) {
    if (t.amount != null && t.price != null && t.price !== 1)
      return formatCurrency(t.amount, t.currency);
    if (t.quantity != null) return `${formatNumber(t.quantity)} 股`;
    return "金額未提供";
  }
</script>

{#if $investments.isPending}<EmptyState
    title="載入投資中"
    body="正在讀取投資持倉。"
  />{:else}<div class="grid gap-5">
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
        <p class="text-xs text-ink/45">持倉市值</p>
        <p class="mt-2 text-xl font-bold">{formatCurrency(total)}</p>
      </div>
      <div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
        <p class="text-xs text-ink/45">未實現損益</p>
        <p
          class={`mt-2 text-xl font-bold ${currentProfitLoss == null ? "text-ink/40" : currentProfitLoss >= 0 ? "text-moss" : "text-coral"}`}
        >
          {currentProfitLoss == null
            ? "—"
            : `${currentProfitLoss >= 0 ? "+" : ""}${formatCurrency(currentProfitLoss)}`}
        </p>
      </div>
      <div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
        <p class="text-xs text-ink/45">未實現報酬率</p>
        <p
          class={`mt-2 text-xl font-bold ${$performance.data?.currentReturnRate == null ? "text-ink/40" : ($performance.data.currentReturnRate ?? 0) >= 0 ? "text-moss" : "text-coral"}`}
        >
          {$performance.data?.currentReturnRate == null
            ? "—"
            : `${$performance.data.currentReturnRate >= 0 ? "+" : ""}${$performance.data.currentReturnRate.toFixed(2)}%`}
        </p>
      </div>
      <div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
        <p class="text-xs text-ink/45">持倉數</p>
        <p class="mt-2 text-xl font-bold">{positions.length}</p>
      </div>
    </div>
    {#if ($investments.data?.length ?? 0) > 0}
      <InvestmentPerformanceChart
        data={$performance.data}
        loading={$performance.isPending}
      />
    {/if}
    <Card
      ><CardHeader class="gap-3"
        ><div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">投資持倉</h2>
          <div class="relative w-52">
            <Search
              class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
            /><Input
              class="pl-9"
              placeholder="搜尋股票／基金"
              bind:value={search}
            />
          </div>
        </div></CardHeader
      ><CardContent class="p-0"
        ><div class="hidden overflow-x-auto md:block">
          <table class="w-full text-left text-sm">
            <thead class="border-y border-ink/8 bg-paper text-xs text-ink/50"
              ><tr
                ><th class="px-5 py-3">名稱</th><th class="px-5 py-3">類型</th
                ><th class="px-5 py-3">數量</th><th class="px-5 py-3 text-right"
                  >持有成本</th
                ><th class="px-5 py-3 text-right">市值</th><th
                  class="px-5 py-3 text-right">未實現損益</th
                ><th class="px-5 py-3">日期</th></tr
              ></thead
            ><tbody class="divide-y divide-ink/8"
              >{#each positions as p (p.id)}{@const unrealized =
                  unrealizedByPosition.get(p.id)}<tr
                  ><td class="px-5 py-3 font-semibold"
                    >{p.symbol ? `${p.symbol} ` : ""}{p.name}</td
                  ><td class="px-5 py-3">{p.assetType.toUpperCase()}</td><td
                    class="px-5 py-3"
                    >{p.quantity == null ? "-" : formatNumber(p.quantity)}</td
                  ><td class="px-5 py-3 text-right text-ink/60"
                    >{unrealized?.costBasis == null
                      ? "待補"
                      : formatCurrency(unrealized.costBasis)}</td
                  ><td class="px-5 py-3 text-right font-semibold"
                    >{formatCurrency(
                      (p.marketValue ?? 0) + (p.cashBalance ?? 0),
                      p.currency,
                    )}</td
                  ><td
                    class={`px-5 py-3 text-right font-semibold ${unrealized?.profitLoss == null ? "text-ink/40" : unrealized.profitLoss >= 0 ? "text-moss" : "text-coral"}`}
                    >{unrealized?.profitLoss == null
                      ? "—"
                      : `${unrealized.profitLoss >= 0 ? "+" : ""}${formatCurrency(unrealized.profitLoss)}`}{#if unrealized?.returnRate != null}<span
                        class="ml-1 text-xs font-medium opacity-70"
                        >({unrealized.returnRate >= 0
                          ? "+"
                          : ""}{unrealized.returnRate.toFixed(1)}%)</span
                      >{/if}</td
                  ><td class="px-5 py-3 text-xs text-ink/50"
                    >{formatDate(p.asOfDate)}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
        <div class="divide-y divide-ink/8 md:hidden">
          {#each positions as p (p.id)}{@const unrealized =
              unrealizedByPosition.get(p.id)}
            <div class="flex items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="truncate font-semibold">
                  {p.symbol ? `${p.symbol} ` : ""}{p.name}
                </p>
                <p class="mt-1 text-xs text-ink/45">
                  {p.quantity ?? 0} 單位 · {p.assetType.toUpperCase()}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <p class="font-bold text-steel">
                  {formatCurrency(
                    (p.marketValue ?? 0) + (p.cashBalance ?? 0),
                    p.currency,
                  )}
                </p>
                <p
                  class={`mt-1 text-xs font-semibold ${unrealized?.profitLoss == null ? "text-ink/40" : unrealized.profitLoss >= 0 ? "text-moss" : "text-coral"}`}
                >
                  {unrealized?.profitLoss == null
                    ? "成本待補"
                    : `${unrealized.profitLoss >= 0 ? "+" : ""}${formatCurrency(unrealized.profitLoss)}`}
                </p>
              </div>
            </div>{/each}
        </div></CardContent
      ></Card
    ><Card
      ><CardHeader class="flex-row items-center justify-between"
        ><h2 class="text-lg font-semibold">交易紀錄</h2>
        <Select class="w-36" bind:value={tradeType}
          ><option value="all">全部類型</option><option value="stock"
            >股票</option
          ><option value="etf">ETF</option><option value="fund">基金</option
          ></Select
        ></CardHeader
      ><CardContent class="p-0"
        ><div class="divide-y divide-ink/8">
          {#each filteredTrades as t (t.id)}<div
              class="flex items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <div class="min-w-0">
                <p class="truncate font-semibold">
                  {t.name ?? t.symbol ?? "投資交易"}
                </p>
                <p class="text-xs text-ink/45">
                  {t.transactionName ?? t.transactionCode ?? ""} · {formatDate(
                    t.tradeDate ?? t.postedDate,
                  )}
                </p>
              </div>
              <span class="shrink-0 font-semibold text-ink/65"
                >{tradeDisplay(t)}</span
              >
            </div>{/each}
        </div></CardContent
      ></Card
    >
  </div>{/if}
