<script lang="ts">
  import type { Snippet } from "svelte";
  let { children, class: className = "" }: { children?: Snippet; class?: string } = $props();
</script>
<div class={`p-5 pt-0 ${className}`}>{@render children?.()}</div>
