<script lang="ts">
  import type { Snippet } from "svelte";
  let { children, class: className = "", as = "div" }: { children?: Snippet; class?: string; as?: "div" | "section" | "article" } = $props();
</script>

{#if as === "section"}
  <section class={`rounded-xl border border-ink/10 bg-white text-ink shadow-xs ${className}`}>{@render children?.()}</section>
{:else if as === "article"}
  <article class={`rounded-xl border border-ink/10 bg-white text-ink shadow-xs ${className}`}>{@render children?.()}</article>
{:else}
  <div class={`rounded-xl border border-ink/10 bg-white text-ink shadow-xs ${className}`}>{@render children?.()}</div>
{/if}
