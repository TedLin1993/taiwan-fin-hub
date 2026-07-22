<script lang="ts">
  import type { Component } from "svelte";
  let {
    icon: Icon,
    size = "md",
    class: className = "",
    label,
  }: {
    icon: Component;
    size?: "sm" | "md" | "lg" | "nav" | "empty";
    class?: string;
    label?: string;
  } = $props();
  const sizes = {
    sm: "size-4",
    md: "size-[18px]",
    lg: "size-5",
    nav: "size-[22px]",
    empty: "size-9",
  };
</script>

<Icon
  aria-hidden={label ? undefined : "true"}
  aria-label={label}
  class={`shrink-0 stroke-[1.8] ${sizes[size]} ${className}`}
/>
