<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../lib/utils";
  let { children, class: className = "", as = "div" }: { children?: Snippet; class?: string; as?: "div" | "section" | "article" } = $props();
  const classes = $derived(cn("rounded-xl border border-border bg-card text-card-foreground shadow-xs", className));
</script>

{#if as === "section"}
  <section class={classes}>{@render children?.()}</section>
{:else if as === "article"}
  <article class={classes}>{@render children?.()}</article>
{:else}
  <div class={classes}>{@render children?.()}</div>
{/if}
