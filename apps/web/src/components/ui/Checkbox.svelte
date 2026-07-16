<script lang="ts">
  import { cn } from "../../lib/utils";
  let {
    class: className = "",
    checked = false,
    ...rest
  }: { class?: string; checked?: boolean; [key: string]: unknown } = $props();
</script>

<input
  {...rest}
  type="checkbox"
  {checked}
  class={cn(
    "size-4 shrink-0 rounded border border-primary accent-primary shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
/>
