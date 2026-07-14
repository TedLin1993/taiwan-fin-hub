import { getContext, setContext, type Component } from "svelte";

export const CHART_THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = Record<string, {
  label?: string;
  icon?: Component;
} & (
  | { color?: string; theme?: never }
  | { color?: never; theme: Record<keyof typeof CHART_THEMES, string> }
)>;

type ChartContextValue = { config: ChartConfig };
const chartContextKey = Symbol("chart-context");

export function setChartContext(value: ChartContextValue) {
  return setContext(chartContextKey, value);
}

export function useChart() {
  return getContext<ChartContextValue>(chartContextKey);
}
