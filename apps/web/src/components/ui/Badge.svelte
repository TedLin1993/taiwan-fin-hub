<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../lib/utils";
  let {
    children,
    class: className = "",
    variant = "default",
  }: {
    children?: Snippet;
    class?: string;
    variant?: "default" | "secondary" | "outline" | "destructive" | "success";
  } = $props();
  const variants = {
    default: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    outline: "border-border text-foreground",
    destructive: "border-transparent bg-destructive/10 text-destructive",
    success: "border-transparent bg-moss/10 text-moss",
  };
</script>

<span
  class={cn(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    variants[variant],
    className,
  )}>{@render children?.()}</span
>
