<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "@/shared/utils/cn";
  let {
    children,
    class: className = "",
  }: { children?: Snippet; class?: string } = $props();
</script>

<p class={cn("text-sm text-muted-foreground", className)}>
  {@render children?.()}
</p>
