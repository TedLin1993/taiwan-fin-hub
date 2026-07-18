<script lang="ts">
  import { cn } from "../../lib/utils";

  let {
    checked = $bindable(false),
    disabled = false,
    class: className = "",
    ...rest
  }: {
    checked?: boolean;
    disabled?: boolean;
    class?: string;
    [key: string]: unknown;
  } = $props();
</script>

<button
  {...rest}
  type="button"
  role="switch"
  aria-checked={checked}
  {disabled}
  class={cn(
    "relative inline-flex size-11 shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  onclick={() => (checked = !checked)}
>
  <span
    class={cn(
      "relative block h-6 w-11 rounded-full transition-colors",
      checked ? "bg-primary" : "bg-input",
    )}
  >
    <span
      class={cn(
        "absolute top-0.5 block size-5 rounded-full bg-background shadow-sm transition-transform",
        checked ? "translate-x-[22px]" : "translate-x-0.5",
      )}
    ></span>
  </span>
</button>
