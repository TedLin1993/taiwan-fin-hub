<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { CreditCard, Search } from "@lucide/svelte";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { BankData, CreditCardBillRow } from "../lib/types";
  import { formatBankAccountName, formatCurrency, formatDate } from "../lib/format.svelte";
  let { api }: { api: ApiClient } = $props();
  const bank = createQuery<BankData>({ queryKey: queryKeys.bank, queryFn: () => api.get<BankData>("/api/bank") });
  const bills = createQuery<CreditCardBillRow[]>({ queryKey: queryKeys.bills, queryFn: () => api.get<CreditCardBillRow[]>("/api/bank/bills") });
  let search = $state("");
  const cards = $derived(($bank.data?.accounts ?? []).filter((a) => a.accountType === "credit"));
  const filteredBills = $derived(($bills.data ?? []).filter((b) => `${b.accountSourceId ?? ""} ${b.billingPeriod}`.toLowerCase().includes(search.toLowerCase())));
  const outstanding = $derived(Math.abs(cards.reduce((s, c) => s + (c.balance ?? 0), 0)));
</script>

{#if $bank.isPending}<EmptyState title="載入信用卡中" body="正在讀取信用卡資料。" />{:else}<div class="grid gap-5"><div class="grid grid-cols-2 gap-3 md:grid-cols-3"><div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">信用卡數</p><p class="mt-2 text-xl font-bold">{cards.length}</p></div><div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">目前已用金額</p><p class="mt-2 text-xl font-bold text-coral">{formatCurrency(outstanding)}</p></div><div class="hidden rounded-xl border border-ink/10 bg-white p-4 shadow-xs md:block"><p class="text-xs text-ink/45">帳單筆數</p><p class="mt-2 text-xl font-bold">{filteredBills.length}</p></div></div><Card><CardHeader><h2 class="text-lg font-semibold">信用卡帳戶</h2></CardHeader><CardContent class="grid gap-3 md:grid-cols-2">{#if cards.length === 0}<p class="py-8 text-center text-sm text-ink/45">尚無信用卡資料。</p>{:else}{#each cards as card, i}<div class={`rounded-2xl p-4 text-white ${i % 2 === 0 ? "bg-ink" : "bg-steel"}`}><div class="flex items-start justify-between"><div><p class="font-semibold">{card.institutionName ?? card.connectorId}</p><p class="mt-2 text-xs text-white/65">{card.accountName ?? formatBankAccountName(card)}</p></div><CreditCard class="size-5 text-white/70" /></div><p class="mt-5 text-2xl font-bold">{formatCurrency(Math.abs(card.balance ?? 0), card.currency)}</p><p class="mt-2 text-xs text-white/60">{card.statementClosingDate ? `結帳日 ${formatDate(card.statementClosingDate)}` : "查看帳單與待入帳紀錄"}</p></div>{/each}{/if}</CardContent></Card><Card><CardHeader class="flex-row items-center justify-between"><h2 class="text-lg font-semibold">信用卡帳單</h2><label class="flex min-h-10 items-center gap-2 rounded-lg border border-ink/10 bg-paper px-3"><Search class="size-4 text-steel" /><input class="w-40 bg-transparent text-sm outline-hidden" placeholder="搜尋帳單" bind:value={search} /></label></CardHeader><CardContent class="p-0"><div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="border-y border-ink/8 bg-paper text-xs text-ink/50"><tr><th class="px-5 py-3">帳戶</th><th class="px-5 py-3">帳期</th><th class="px-5 py-3 text-right">帳單金額</th><th class="px-5 py-3">繳款期限</th><th class="px-5 py-3">狀態</th></tr></thead><tbody class="divide-y divide-ink/8">{#each filteredBills as bill}<tr><td class="px-5 py-3">{bill.accountSourceId ?? bill.sourceId}</td><td class="px-5 py-3">{bill.billingPeriod}</td><td class="px-5 py-3 text-right font-semibold">{bill.statementAmount == null ? "-" : formatCurrency(bill.statementAmount, bill.currency)}</td><td class="px-5 py-3">{formatDate(bill.paymentDueDate)}</td><td class="px-5 py-3">{bill.isPaid ? "已繳" : "待繳"}</td></tr>{/each}</tbody></table></div></CardContent></Card></div>{/if}
