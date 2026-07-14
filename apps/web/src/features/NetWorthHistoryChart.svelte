<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowDownRight, ArrowUpRight, TrendingUp } from "@lucide/svelte";
  import { curveMonotoneX } from "d3-shape";
  import { LineChart } from "layerchart";
  import Card from "../components/ui/Card.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import { ChartContainer, ChartTooltip, type ChartConfig } from "../components/ui/chart";
  import { formatCompactTwd, formatCurrency, formatDate } from "../lib/format.svelte";
  import {
    buildNetWorthChartData,
    getAvailableNetWorthAssets,
    NET_WORTH_ASSET_SERIES,
    NET_WORTH_DEFAULT_ASSETS,
    type NetWorthAssetType,
    type NetWorthChartPoint,
    type NetWorthDisplayMode,
    type NetWorthTimeframe
  } from "../lib/net-worth-chart";
  import type { NetWorthHistoryRow } from "../lib/types";

  let { data = [], loading = false }: { data?: NetWorthHistoryRow[]; loading?: boolean } = $props();

  const storageKey = "taiwan-fin-hub-net-worth-chart-included-assets";
  const timeframes: NetWorthTimeframe[] = ["1M", "3M", "6M", "1Y", "ALL"];
  const chartConfig: ChartConfig = {
    selectedTotal: { label: "淨資產", color: "#3e6f7c" },
    stock: { label: "股票/ETF", color: "#6574cd" },
    fund: { label: "基金", color: "#9b6bb0" },
    deposit: { label: "存款", color: "#3e6f7c" },
    manual: { label: "其他資產", color: "#b5853f" }
  };

  let includedAssets = $state<NetWorthAssetType[]>([...NET_WORTH_DEFAULT_ASSETS]);
  let timeframe = $state<NetWorthTimeframe>("1Y");
  let displayMode = $state<NetWorthDisplayMode>("sum");

  const availableAssets = $derived(getAvailableNetWorthAssets(data));
  const chartData = $derived(buildNetWorthChartData(data, includedAssets, timeframe));
  const firstValue = $derived(chartData[0]?.selectedTotal ?? 0);
  const latestValue = $derived(chartData.at(-1)?.selectedTotal ?? 0);
  const changeValue = $derived(latestValue - firstValue);
  const changePercent = $derived(firstValue === 0 ? 0 : changeValue / Math.abs(firstValue) * 100);
  const chartSeries = $derived(
    displayMode === "sum"
      ? [{ key: "selectedTotal", label: "淨資產", value: "selectedTotal", color: "var(--color-selectedTotal)" }]
      : NET_WORTH_ASSET_SERIES
          .filter(({ key }) => includedAssets.includes(key))
          .map(({ key, label }) => ({ key, label, value: key, color: `var(--color-${key})` }))
  );

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (!Array.isArray(saved)) return;
      const valid = saved.filter((value): value is NetWorthAssetType =>
        ["stock", "fund", "deposit", "manual"].includes(value)
      );
      if (valid.length) includedAssets = valid;
    } catch { /* keep defaults */ }
  });

  function toggleAsset(asset: NetWorthAssetType) {
    if (!availableAssets.has(asset)) return;
    const next = includedAssets.includes(asset)
      ? includedAssets.filter((item) => item !== asset)
      : [...includedAssets, asset];
    if (next.length === 0) return;
    includedAssets = next;
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function xValue(point: NetWorthChartPoint) {
    return new Date(`${point.date}T00:00:00`);
  }

  function formatAxisDate(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(date);
  }
</script>

{#snippet chartTooltip()}
  <ChartTooltip
    indicator={displayMode === "sum" ? "dot" : "line"}
    labelFormatter={(value) => formatDate(value instanceof Date ? value.toISOString() : String(value))}
    valueFormatter={(value) => formatCurrency(Number(value))}
  />
{/snippet}

<Card class="min-w-0 max-w-full overflow-hidden">
  <CardHeader class="gap-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <TrendingUp class="size-4 text-steel" />淨資產趨勢
        </h2>
        {#if chartData.length > 0}
          <div class="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="text-2xl font-bold tracking-tight tabular-nums">{formatCurrency(latestValue)}</span>
            <span class={`inline-flex items-center gap-1 text-xs font-semibold ${changeValue >= 0 ? "text-moss" : "text-coral"}`}>
              {#if changeValue >= 0}<ArrowUpRight class="size-3.5" />{:else}<ArrowDownRight class="size-3.5" />{/if}
              {changeValue >= 0 ? "+" : ""}{formatCompactTwd(changeValue)}（{changePercent >= 0 ? "+" : ""}{changePercent.toFixed(1)}%）
            </span>
          </div>
        {/if}
      </div>
      <div class="inline-flex w-fit rounded-lg border border-ink/10 bg-ink/3 p-1 text-xs font-medium">
        {#each [{ key: "sum", label: "總和" }, { key: "breakdown", label: "分類" }] as option}
          <button
            class={`rounded-md px-3 py-1.5 transition ${displayMode === option.key ? "bg-white text-ink shadow-xs" : "text-ink/55 hover:text-ink"}`}
            onclick={() => displayMode = option.key as NetWorthDisplayMode}
          >{option.label}</button>
        {/each}
      </div>
    </div>
    <div class="flex flex-wrap gap-1.5" aria-label="資產類型篩選">
      {#each NET_WORTH_ASSET_SERIES as option}
        {@const active = includedAssets.includes(option.key)}
        {@const available = availableAssets.has(option.key)}
        <button
          class={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${active && available ? "border-transparent bg-steel/15 text-steel" : "border-ink/8 bg-white text-ink/45"} ${available ? "hover:border-steel/25 hover:text-steel" : "cursor-not-allowed opacity-40"}`}
          disabled={!available}
          aria-pressed={active}
          onclick={() => toggleAsset(option.key)}
        >{option.label}</button>
      {/each}
    </div>
  </CardHeader>
  <CardContent class="min-w-0 overflow-hidden px-3 sm:px-5">
    {#if loading}
      <div class="flex h-64 items-center justify-center text-sm text-ink/45">載入趨勢中…</div>
    {:else if chartData.length === 0}
      <div class="flex h-64 items-center justify-center rounded-lg bg-ink/2 text-sm text-ink/45">尚無淨資產歷史資料。</div>
    {:else}
      <ChartContainer config={chartConfig} class="h-72 min-h-72 w-full min-w-0 sm:h-80 sm:min-h-80">
        <LineChart
          data={chartData}
          x={xValue}
          series={chartSeries}
          padding={{ top: 16, right: 18, bottom: 28, left: 48 }}
          yBaseline={null}
          yNice={true}
          axis={true}
          grid={false}
          tooltip={chartTooltip}
          props={{
            xAxis: { format: formatAxisDate, tickSpacing: 72, tickMarks: false },
            yAxis: { format: (value: unknown) => formatCompactTwd(Number(value)), tickSpacing: 52, tickMarks: false, grid: true },
            spline: { curve: curveMonotoneX, strokeWidth: 2.5 },
            highlight: { points: true, lines: true }
          }}
        />
      </ChartContainer>
      <div class="mt-3 flex min-w-0 flex-col items-stretch gap-3 border-t border-ink/8 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {#if displayMode === "breakdown"}
          <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink/55">
            {#each NET_WORTH_ASSET_SERIES.filter(({ key }) => includedAssets.includes(key)) as item}
              <span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" style={`background:${item.color}`}></span>{item.label}</span>
            {/each}
          </div>
        {:else}
          <span class="text-xs text-ink/45">已選資產的每日合計</span>
        {/if}
        <div class="grid w-full grid-cols-5 rounded-lg bg-ink/3 p-1 text-xs font-medium sm:ml-auto sm:flex sm:w-auto">
          {#each timeframes as option}
            <button
              class={`rounded-md px-2 py-1 transition sm:px-2.5 ${timeframe === option ? "bg-white text-ink shadow-xs" : "text-ink/45 hover:text-ink"}`}
              onclick={() => timeframe = option}
            >{option === "ALL" ? "全部" : option}</button>
          {/each}
        </div>
      </div>
    {/if}
  </CardContent>
</Card>
