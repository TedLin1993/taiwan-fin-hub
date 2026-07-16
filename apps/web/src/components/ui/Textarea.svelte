<script lang="ts">
  import { cn } from "../../lib/utils";
  let {
    class: className = "",
    value = $bindable(),
    ...rest
  }: { class?: string; value?: string; [key: string]: unknown } = $props();
</script>

<textarea
  {...rest}
  bind:value
  class={cn(
    "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}></textarea>
