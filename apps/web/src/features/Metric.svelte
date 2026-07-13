<script lang="ts">
  let { label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "positive" | "negative" } = $props();
</script>
<div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs font-semibold text-ink/45">{label}</p><p class={`mt-2 text-2xl font-bold ${tone === "positive" ? "text-moss" : tone === "negative" ? "text-coral" : ""}`}>{value}</p><p class="mt-1 text-xs text-ink/45">{detail}</p></div>
