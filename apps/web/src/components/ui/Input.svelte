<script lang="ts">
  import { cn } from "../../lib/utils";
  let { class: className = "", value = $bindable(), type = "text", ...rest }: { class?: string; value?: string | number; type?: string; [key: string]: unknown } = $props();
</script>
<input {...rest} {type} bind:value class={cn("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", className)} />
