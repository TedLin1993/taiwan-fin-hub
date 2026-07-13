<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { Search } from "@lucide/svelte";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { InvoiceRow } from "../lib/types";
  import { formatCurrency, formatDate } from "../lib/format.svelte";
  let { api }: { api: ApiClient } = $props();
  const invoices = createQuery<InvoiceRow[]>({ queryKey: queryKeys.invoices, queryFn: () => api.get<InvoiceRow[]>("/api/invoices") });
  let search = $state("");
  let expanded = $state<Record<string, boolean>>({});
  const filtered = $derived(($invoices.data ?? []).filter((i) => `${i.sellerName ?? ""} ${i.invoiceNumber ?? ""} ${i.items.map((x) => x.description).join(" ")}`.toLowerCase().includes(search.toLowerCase())));
  const months = $derived([...new Set(filtered.map((i) => i.invoiceDate.slice(0, 7)))].sort((a, b) => b.localeCompare(a)));
  const total = $derived(filtered.reduce((s, i) => s + i.amount, 0));
  const thisMonth = $derived(new Date().toISOString().slice(0, 7));
  const thisMonthTotal = $derived(filtered.filter((i) => i.invoiceDate.startsWith(thisMonth)).reduce((s, i) => s + i.amount, 0));
</script>

{#if $invoices.isPending}<EmptyState title="載入發票中" body="正在讀取電子發票資料。" />{:else if $invoices.isError}<EmptyState title="無法載入發票" body="請稍後再試。" />{:else}<div class="grid gap-4"><div class="grid gap-3 sm:grid-cols-3"><div class="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-xs"><p class="text-xs text-ink/50">發票筆數</p><p class="mt-1 text-xl font-semibold">{filtered.length}</p></div><div class="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-xs"><p class="text-xs text-ink/50">本月消費</p><p class="mt-1 text-xl font-semibold">{formatCurrency(thisMonthTotal)}</p></div><div class="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-xs"><p class="text-xs text-ink/50">目前篩選總額</p><p class="mt-1 text-xl font-semibold">{formatCurrency(total)}</p></div></div><Card><CardHeader class="gap-3"><div class="flex items-center justify-between gap-3"><div><h2 class="text-lg font-semibold">電子發票</h2><p class="text-xs text-ink/45">搜尋商家、發票號碼與品項明細</p></div><label class="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-ink/10 bg-paper px-3 sm:max-w-sm"><Search class="size-4 text-steel" /><input class="w-full bg-transparent text-sm outline-hidden" placeholder="搜尋發票" bind:value={search} /></label></div></CardHeader><CardContent class="grid gap-4">{#if filtered.length === 0}<p class="py-8 text-center text-sm text-ink/50">沒有符合條件的發票。</p>{:else}{#each months as month}<section><div class="mb-2 flex items-center justify-between"><h3 class="font-semibold">{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</h3><span class="text-xs font-semibold text-ink/55">{formatCurrency(filtered.filter((i) => i.invoiceDate.startsWith(month)).reduce((s, i) => s + i.amount, 0))}</span></div><div class="divide-y divide-ink/8 overflow-hidden rounded-xl border border-ink/10">{#each filtered.filter((i) => i.invoiceDate.startsWith(month)) as invoice}<div class="bg-white"><button class="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left" onclick={() => expanded[invoice.id] = !expanded[invoice.id]}><div class="min-w-0"><p class="truncate font-semibold">{invoice.sellerName ?? "電子發票"}</p><p class="mt-1 text-xs text-ink/45">{formatDate(invoice.invoiceDate)} · {invoice.invoiceNumber ?? "無號碼"} · {invoice.items.length} 項</p></div><p class="shrink-0 text-sm font-bold tabular-nums">{formatCurrency(invoice.amount)}</p></button>{#if expanded[invoice.id]}<div class="border-t border-ink/8 bg-paper px-4 py-3">{#each invoice.items as item}<div class="flex items-center justify-between gap-3 py-1 text-sm"><span class="truncate">{item.description} {item.quantity ? `× ${item.quantity}` : ""}</span><span class="shrink-0 tabular-nums">{formatCurrency(item.amount)}</span></div>{/each}</div>{/if}</div>{/each}</div></section>{/each}{/if}</CardContent></Card></div>{/if}
