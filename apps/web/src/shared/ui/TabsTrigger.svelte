<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@/shared/utils/cn";
  let {
    children,
    class: className = "",
    active = false,
    disabled = false,
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    active?: boolean;
    disabled?: boolean;
    [key: string]: unknown;
  } = $props();
</script>

<button
  {...rest}
  role="tab"
  aria-selected={active}
  {disabled}
  class={cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    active
      ? "bg-background text-foreground shadow-xs"
      : "hover:text-foreground",
    className,
  )}>{@render children?.()}</button
>
