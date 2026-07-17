<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { CreditCard, Search } from "@lucide/svelte";
  import Card from "../../components/ui/Card.svelte";
  import CardHeader from "../../components/ui/CardHeader.svelte";
  import CardContent from "../../components/ui/CardContent.svelte";
  import EmptyState from "../../components/ui/EmptyState.svelte";
  import Input from "../../components/ui/Input.svelte";
  import type { ApiClient } from "../../lib/api";
  import { bankQuery, creditCardBillsQuery } from "../../lib/queries";
  import type { CreditCardBillRow } from "../../lib/types";
  import {
    formatBankAccountName,
    formatCurrency,
    formatDate,
  } from "../../lib/format.svelte";
  let { api }: { api: ApiClient } = $props();
  const bank = createQuery(bankQuery(() => api));
  const bills = createQuery(creditCardBillsQuery(() => api));
  let search = $state("");
  const cards = $derived(
    ($bank.data?.accounts ?? []).filter((a) => a.accountType === "credit"),
  );
  const cardsById = $derived(new Map(cards.map((card) => [card.id, card])));
  const filteredBills = $derived(
    ($bills.data ?? []).filter((b) =>
      `${b.accountSourceId ?? ""} ${b.billingPeriod}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  const outstanding = $derived(
    Math.abs(cards.reduce((s, c) => s + (c.balance ?? 0), 0)),
  );
  function billAccountName(bill: CreditCardBillRow) {
    const card = cardsById.get(bill.accountId);
    return card?.accountName ?? card?.institutionName ?? "信用卡帳戶";
  }
</script>

{#if $bank.isPending}<EmptyState
    title="載入信用卡中"
    body="正在讀取信用卡資料。"
  />{:else}<div class="grid min-w-0 gap-5">
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
      <div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
        <p class="text-xs text-ink/45">信用卡數</p>
        <p class="mt-2 text-xl font-bold">{cards.length}</p>
      </div>
      <div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs">
        <p class="text-xs text-ink/45">目前已用金額</p>
        <p class="mt-2 text-xl font-bold text-coral">
          {formatCurrency(outstanding)}
        </p>
      </div>
      <div
        class="hidden rounded-xl border border-ink/10 bg-white p-4 shadow-xs md:block"
      >
        <p class="text-xs text-ink/45">帳單筆數</p>
        <p class="mt-2 text-xl font-bold">{filteredBills.length}</p>
      </div>
    </div>
    <Card
      ><CardHeader><h2 class="text-lg font-semibold">信用卡帳戶</h2></CardHeader
      ><CardContent class="grid gap-3 md:grid-cols-2"
        >{#if cards.length === 0}<p
            class="py-8 text-center text-sm text-ink/45"
          >
            尚無信用卡資料。
          </p>{:else}{#each cards as card, i (card.id)}<div
              class={`rounded-2xl p-4 text-white ${i % 2 === 0 ? "bg-ink" : "bg-steel"}`}
            >
              <div class="flex items-start justify-between">
                <div>
                  <p class="font-semibold">
                    {card.institutionName ?? card.connectorId}
                  </p>
                  <p class="mt-2 text-xs text-white/65">
                    {card.accountName ?? formatBankAccountName(card)}
                  </p>
                </div>
                <CreditCard class="size-5 text-white/70" />
              </div>
              <p class="mt-5 text-2xl font-bold">
                {card.balance == null
                  ? "尚無餘額"
                  : formatCurrency(Math.abs(card.balance), card.currency)}
              </p>
              <p class="mt-2 text-xs text-white/60">
                {card.statementClosingDate
                  ? `結帳日 ${formatDate(card.statementClosingDate)}`
                  : "查看帳單與待入帳紀錄"}
              </p>
            </div>{/each}{/if}</CardContent
      ></Card
    ><Card class="min-w-0 max-w-full overflow-hidden"
      ><CardHeader class="flex-row items-center justify-between"
        ><h2 class="text-lg font-semibold">信用卡帳單</h2>
        <div class="relative w-44">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          /><Input class="pl-9" placeholder="搜尋帳單" bind:value={search} />
        </div></CardHeader
      ><CardContent class="min-w-0 p-0"
        ><div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-[680px] text-left text-sm">
            <thead class="border-y border-ink/8 bg-paper text-xs text-ink/50"
              ><tr
                ><th class="px-5 py-3">帳戶</th><th class="px-5 py-3">帳期</th
                ><th class="px-5 py-3 text-right">帳單金額</th><th
                  class="px-5 py-3">繳款期限</th
                ><th class="px-5 py-3">狀態</th></tr
              ></thead
            ><tbody class="divide-y divide-ink/8"
              >{#each filteredBills as bill (bill.id)}<tr
                  ><td class="px-5 py-3 font-medium">{billAccountName(bill)}</td
                  ><td class="px-5 py-3">{bill.billingPeriod}</td><td
                    class="px-5 py-3 text-right font-semibold"
                    >{bill.statementAmount == null
                      ? "-"
                      : formatCurrency(bill.statementAmount, bill.currency)}</td
                  ><td class="px-5 py-3"
                    >{bill.paymentDueDate
                      ? formatDate(bill.paymentDueDate)
                      : "—"}</td
                  ><td class="px-5 py-3">{bill.isPaid ? "已繳" : "待繳"}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div></CardContent
      ></Card
    >
  </div>{/if}
