<script lang="ts">
  import type { Snippet } from "svelte";
  let { children, class: className = "" }: { children?: Snippet; class?: string } = $props();
</script>
<div class={`flex flex-col gap-1.5 p-5 ${className}`}>{@render children?.()}</div>
