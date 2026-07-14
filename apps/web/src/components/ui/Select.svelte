<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../lib/utils";
  let { children, class: className = "", value = $bindable(), ...rest }: { children?: Snippet; class?: string; value?: string | number; [key: string]: unknown } = $props();
</script>
<select {...rest} bind:value class={cn("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", className)}>{@render children?.()}</select>
