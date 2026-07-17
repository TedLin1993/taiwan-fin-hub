<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../lib/utils";
  let {
    children,
    class: className = "",
  }: { children?: Snippet; class?: string } = $props();
</script>

<h3 class={cn("font-semibold leading-none tracking-tight", className)}>
  {@render children?.()}
</h3>
