<script lang="ts">
  import { onMount } from "svelte";
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { Save } from "@lucide/svelte";
  import Card from "../../components/ui/Card.svelte";
  import CardHeader from "../../components/ui/CardHeader.svelte";
  import CardContent from "../../components/ui/CardContent.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Input from "../../components/ui/Input.svelte";
  import type { ApiClient } from "../../lib/api";
  import { queryKeys } from "../../lib/api";
  import { bankQuery, exchangeRatesQuery } from "../../lib/queries";
  let { api }: { api: ApiClient } = $props();
  const rates = createQuery(exchangeRatesQuery(() => api));
  const bank = createQuery(bankQuery(() => api));
  const qc = useQueryClient();
  let values = $state<Record<string, string>>({});
  const currencies = $derived([
    ...new Set(
      ($bank.data?.accounts ?? [])
        .map((a) => a.currency)
        .filter((c) => c && c !== "TWD"),
    ),
  ]);
  const save = createMutation({
    mutationFn: (payload: Record<string, number>) =>
      api.put("/api/exchange-rates", { rates: payload }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.exchangeRates }),
  });
  onMount(() =>
    rates.subscribe((result) => {
      for (const rate of result.data ?? []) {
        if (values[rate.currency] === undefined)
          values[rate.currency] = String(rate.rateTwd);
      }
    }),
  );
</script>

<Card
  ><CardHeader
    ><h2 class="text-lg font-semibold">匯率</h2>
    <p class="text-xs text-muted-foreground">
      管理外幣換算使用的參考匯率
    </p></CardHeader
  ><CardContent
    ><div class="grid gap-3">
      {#if currencies.length === 0}<p class="text-sm text-muted-foreground">
          目前沒有外幣帳戶。
        </p>{:else}{#each currencies as currency (currency)}<label
            class="flex items-center justify-between gap-3 text-sm"
            ><span class="font-semibold">{currency}</span><Input
              class="w-32 text-right"
              type="number"
              step="0.0001"
              bind:value={values[currency]}
            /></label
          >{/each}<Button
          variant="primary"
          disabled={$save.isPending}
          onclick={() =>
            $save.mutate(
              Object.fromEntries(
                Object.entries(values).map(([k, v]) => [k, Number(v)]),
              ),
            )}
          ><Save class="size-4" />{$save.isPending
            ? "儲存中…"
            : "儲存匯率"}</Button
        >{/if}
    </div></CardContent
  ></Card
>
