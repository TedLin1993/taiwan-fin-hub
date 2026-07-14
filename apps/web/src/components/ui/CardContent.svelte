<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../lib/utils";
  let { children, class: className = "" }: { children?: Snippet; class?: string } = $props();
</script>
<div class={cn("p-5 pt-0", className)}>{@render children?.()}</div>
