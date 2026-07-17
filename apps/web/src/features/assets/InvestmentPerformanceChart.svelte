<script lang="ts">
  import { Info, TrendingDown, TrendingUp } from "@lucide/svelte";
  import { LineChart } from "layerchart";
  import Card from "../../components/ui/Card.svelte";
  import CardContent from "../../components/ui/CardContent.svelte";
  import CardHeader from "../../components/ui/CardHeader.svelte";
  import {
    ChartContainer,
    ChartTooltip,
    type ChartConfig,
  } from "../../components/ui/chart";
  import {
    formatCompactTwd,
    formatCurrency,
    formatDate,
  } from "../../lib/format.svelte";
  import type { InvestmentUnrealizedPerformance } from "../../lib/types";

  let {
    data,
    loading = false,
  }: {
    data?: InvestmentUnrealizedPerformance;
    loading?: boolean;
  } = $props();

  const positive = $derived((data?.currentProfitLoss ?? 0) >= 0);
  const lineColor = $derived(positive ? "#556b2f" : "#b75b45");
  const chartConfig = $derived({
    profitLoss: { label: "未實現損益", color: lineColor },
  } satisfies ChartConfig);
  const chartSeries = $derived([
    {
      key: "profitLoss",
      label: "未實現損益",
      value: "profitLoss",
      color: "var(--color-profitLoss)",
    },
  ]);
  const missingPositions = $derived(
    Math.max(0, (data?.totalPositions ?? 0) - (data?.coveredPositions ?? 0)),
  );

  function xValue(point: { date: string }) {
    return new Date(`${point.date}T00:00:00`);
  }

  function formatAxisDate(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      month: "numeric",
      day: "numeric",
    }).format(date);
  }
</script>

{#snippet chartTooltip()}
  <ChartTooltip
    labelFormatter={(value) =>
      formatDate(value instanceof Date ? value.toISOString() : String(value))}
    valueFormatter={(value) => formatCurrency(Number(value))}
  />
{/snippet}

<Card class="min-w-0 max-w-full overflow-hidden">
  <CardHeader class="gap-3 p-4 md:p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-base font-semibold">
          {#if positive}<TrendingUp
              class="size-4 text-moss"
            />{:else}<TrendingDown class="size-4 text-coral" />{/if}
          未實現損益走勢
        </h2>
        {#if data?.periodStart && data.periodEnd}
          <p class="mt-1 text-xs text-ink/45">
            {formatDate(data.periodStart)}－{formatDate(data.periodEnd)}
          </p>
        {/if}
      </div>
      <span
        class="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-1 text-xs text-ink/55"
      >
        <Info class="size-3.5" />{missingPositions > 0
          ? "TDCC 無成交成本"
          : "移動平均成本，未含費稅"}
      </span>
    </div>
  </CardHeader>
  <CardContent class="min-w-0 overflow-hidden px-3 pb-4 sm:px-5 sm:pb-5">
    {#if loading}
      <div class="flex h-56 items-center justify-center text-sm text-ink/45">
        正在計算未實現損益…
      </div>
    {:else if missingPositions > 0}
      <div
        class="flex h-56 flex-col items-center justify-center rounded-lg bg-ink/2 px-6 text-center"
      >
        <p class="font-semibold text-ink/70">TDCC 未提供持有成本</p>
        <p class="mt-2 max-w-md text-sm leading-6 text-ink/45">
          目前有 {missingPositions} 筆持倉只有異動股數與交易後餘額，沒有券商成交價。系統已略過固定值
          1，不再將它誤算為每股成本。
        </p>
      </div>
    {:else if !data?.points.length}
      <div
        class="flex h-56 items-center justify-center rounded-lg bg-ink/2 px-6 text-center text-sm text-ink/45"
      >
        目前成本可計算，但尚無每日投資市值可繪製歷史線。
      </div>
    {:else}
      <ChartContainer
        config={chartConfig}
        class="h-56 min-h-56 w-full min-w-0 sm:h-64 sm:min-h-64"
      >
        <LineChart
          data={data.points}
          x={xValue}
          series={chartSeries}
          padding={{ top: 16, right: 18, bottom: 28, left: 52 }}
          yBaseline={0}
          yNice={true}
          axis={true}
          grid={false}
          tooltip={chartTooltip}
          props={{
            xAxis: {
              format: formatAxisDate,
              tickSpacing: 72,
              tickMarks: false,
            },
            yAxis: {
              format: (value: unknown) => formatCompactTwd(Number(value)),
              tickSpacing: 52,
              tickMarks: false,
              grid: true,
            },
            spline: { strokeWidth: 2.5 },
            highlight: { points: true, lines: true },
          }}
        />
      </ChartContainer>
      <div
        class="mt-2 flex items-center justify-between gap-3 border-t border-ink/8 pt-3 text-xs text-ink/45"
      >
        <span>每日市值 − 當日持有成本</span>
        <span>{data.points.length} 個資料點</span>
      </div>
    {/if}
  </CardContent>
</Card>
