<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@/shared/utils/cn";
  let {
    children,
    class: className = "",
  }: { children?: Snippet; class?: string } = $props();
</script>

<div
  role="tablist"
  class={cn(
    "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
    className,
  )}
>
  {@render children?.()}
</div>
