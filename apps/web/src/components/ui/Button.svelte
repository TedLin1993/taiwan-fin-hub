<script lang="ts">
  import type { Snippet } from "svelte";
  let { children, class: className = "", variant = "default", size = "default", disabled = false, type = "button", ...rest }: {
    children?: Snippet; class?: string; variant?: "default" | "primary" | "secondary" | "ghost" | "destructive";
    size?: "sm" | "default" | "touch" | "icon"; disabled?: boolean; type?: "button" | "submit" | "reset";
    [key: string]: unknown;
  } = $props();
  const variants = {
    default: "bg-ink text-white shadow-xs hover:bg-ink/90",
    primary: "bg-steel text-white shadow-xs hover:bg-steel/90",
    secondary: "border border-ink/10 bg-white text-ink shadow-xs hover:bg-ink/5",
    ghost: "text-ink/70 hover:bg-ink/5 hover:text-ink",
    destructive: "bg-coral text-white shadow-xs hover:bg-coral/90"
  };
  const sizes = { sm: "h-9 px-3 [&_svg]:size-4", default: "h-10 px-4 [&_svg]:size-4", touch: "min-h-11 px-4 [&_svg]:size-5", icon: "size-11 p-0 [&_svg]:size-5" };
</script>

<button {...rest} {disabled} {type} class={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-steel focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 ${variants[variant]} ${sizes[size]} ${className}`}>
  {@render children?.()}
</button>
