<script lang="ts">
  import { CHART_THEMES, type ChartConfig } from "./chart-utils";

  let { id, config }: { id: string; config: ChartConfig } = $props();

  const themeContents = $derived.by(() => {
    const colorConfig = Object.entries(config).filter(
      ([, item]) => item.theme || item.color,
    );
    if (colorConfig.length === 0) return "";

    return Object.entries(CHART_THEMES)
      .map(([theme, prefix]) => {
        const variables = colorConfig
          .map(([key, item]) => {
            const color =
              item.theme?.[theme as keyof typeof item.theme] ?? item.color;
            return color ? `  --color-${key}: ${color};` : "";
          })
          .filter(Boolean)
          .join("\n");
        return `${prefix} [data-chart="${id}"] {\n${variables}\n}`;
      })
      .join("\n");
  });
</script>

{#if themeContents}
  <svelte:element this={"style"}>{themeContents}</svelte:element>
{/if}
