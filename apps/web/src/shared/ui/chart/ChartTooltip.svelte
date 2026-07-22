<script lang="ts">
  import { getChartContext, Tooltip as TooltipPrimitive } from "layerchart";
  import { cn } from "@/shared/utils/cn";
  import { useChart } from "./chart-utils";

  let {
    class: className,
    labelFormatter = (value: unknown) => String(value ?? ""),
    titleFormatter,
    valueFormatter = (value: unknown) => String(value ?? ""),
    hideItemLabel = false,
    indicator = "dot",
  }: {
    class?: string;
    labelFormatter?: (value: unknown) => string;
    titleFormatter?: (data: unknown, header: unknown) => string;
    valueFormatter?: (value: unknown, key: string) => string;
    hideItemLabel?: boolean;
    indicator?: "dot" | "line";
  } = $props();

  const chart = useChart();
  const context = getChartContext();
  const visibleSeries = $derived(
    context.tooltip.series.filter((series) => series.visible),
  );
  const header = $derived(
    context.tooltip.data ? context.x(context.tooltip.data) : undefined,
  );
</script>

<TooltipPrimitive.Root variant="none" portal={true}>
  <div
    class={cn(
      "grid min-w-40 gap-2 rounded-lg border border-ink/10 bg-white/95 px-3 py-2 text-xs text-ink shadow-xl backdrop-blur-sm",
      className,
    )}
  >
    <p class="font-semibold">
      {titleFormatter
        ? titleFormatter(context.tooltip.data, header)
        : labelFormatter(header)}
    </p>
    <div class="grid gap-1.5">
      {#each visibleSeries as series (series.key)}
        {@const itemConfig = chart.config[series.key]}
        {@const color = series.color ?? itemConfig?.color ?? "#3e6f7c"}
        <div
          class={cn(
            "grid items-center gap-2",
            hideItemLabel
              ? "grid-cols-[auto_auto] justify-between"
              : "grid-cols-[auto_minmax(0,1fr)_auto]",
          )}
        >
          <span
            class={cn(
              "shrink-0 rounded-sm",
              indicator === "line" ? "h-0.5 w-3" : "size-2.5",
            )}
            style={`background-color: ${color}`}
          ></span>
          {#if !hideItemLabel}<span class="text-ink/55"
              >{itemConfig?.label ?? series.label ?? series.key}</span
            >{/if}
          <span class="font-semibold tabular-nums"
            >{valueFormatter(series.value, series.key)}</span
          >
        </div>
      {/each}
    </div>
  </div>
</TooltipPrimitive.Root>
