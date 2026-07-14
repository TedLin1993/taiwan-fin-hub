<script lang="ts">
  import Card from "../components/ui/Card.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  let { label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "positive" | "negative" } = $props();
</script>
<Card><CardContent class="p-4"><p class="text-xs font-semibold text-muted-foreground">{label}</p><p class={`mt-2 text-2xl font-bold ${tone === "positive" ? "text-moss" : tone === "negative" ? "text-coral" : ""}`}>{value}</p><p class="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
