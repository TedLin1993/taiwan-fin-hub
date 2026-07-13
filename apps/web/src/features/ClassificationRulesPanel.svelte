<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from "@tanstack/svelte-query";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import Button from "../components/ui/Button.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { ClassificationRuleRow } from "../lib/types";
  let { api }: { api: ApiClient } = $props();
  const rules = createQuery<ClassificationRuleRow[]>({ queryKey: queryKeys.classificationRules, queryFn: () => api.get<ClassificationRuleRow[]>("/api/classification/rules") });
  const qc = useQueryClient();
  let newRule = $state({ categoryId: "food", pattern: "", operator: "contains" });
  const add = createMutation({ mutationFn: () => api.post("/api/classification/rules", { ...newRule, targetType: "bank_transaction", field: "any_text", priority: 200 }), onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.classificationRules }); newRule = { categoryId: "food", pattern: "", operator: "contains" }; } });
  const toggle = createMutation({ mutationFn: (payload: { id: string; enabled: boolean }) => api.put(`/api/classification/rules/${payload.id}`, { enabled: payload.enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.classificationRules }) });
  const remove = createMutation({ mutationFn: (id: string) => api.delete(`/api/classification/rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.classificationRules }) });
</script>
<Card><CardHeader class="flex-row items-center justify-between"><div><h2 class="text-lg font-semibold">分類規則</h2><p class="text-xs text-ink/45">讓銀行交易依條件自動分類</p></div><span class="text-xs font-semibold text-steel">{$rules.data?.length ?? 0} 條</span></CardHeader><CardContent><div class="mb-4 grid gap-2 rounded-xl border border-steel/20 bg-steel/5 p-3 md:grid-cols-[120px_120px_1fr_auto]"><select class="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm outline-hidden" bind:value={newRule.categoryId}><option value="food">餐飲</option><option value="shopping">購物</option><option value="transport">交通</option><option value="other">其他</option></select><select class="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm outline-hidden" bind:value={newRule.operator}><option value="contains">包含</option><option value="equals">完全等於</option></select><input class="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm outline-hidden" placeholder="比對文字" bind:value={newRule.pattern} /><Button size="sm" disabled={!newRule.pattern.trim()} onclick={() => $add.mutate()}>新增</Button></div><div class="divide-y divide-ink/8">{#each $rules.data ?? [] as rule}<div class="flex items-center gap-3 py-3 text-sm"><input type="checkbox" checked={rule.enabled} onchange={(e) => $toggle.mutate({ id: rule.id, enabled: (e.currentTarget as HTMLInputElement).checked })} /><span class="min-w-0 flex-1 truncate"><strong>{rule.categoryId}</strong> · {rule.operator}「{rule.pattern}」</span><button class="text-xs text-coral" onclick={() => $remove.mutate(rule.id)}>刪除</button></div>{/each}</div></CardContent></Card>
