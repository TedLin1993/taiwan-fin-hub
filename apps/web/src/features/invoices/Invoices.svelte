<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { ChevronDown, Search } from "@lucide/svelte";
  import Button from "../../components/ui/Button.svelte";
  import EmptyState from "../../components/ui/EmptyState.svelte";
  import Input from "../../components/ui/Input.svelte";
  import type { ApiClient } from "../../lib/api";
  import { invoicesQuery } from "../../lib/queries";
  import { formatCurrency, formatDate } from "../../lib/format.svelte";

  let { api }: { api: ApiClient } = $props();
  const invoices = createQuery(invoicesQuery(() => api));
  let search = $state("");
  let expanded = $state<Record<string, boolean>>({});
  const all = $derived($invoices.data ?? []);
  const filtered = $derived(all.filter((invoice) => `${invoice.sellerName ?? ""} ${invoice.invoiceNumber ?? ""} ${invoice.items.map((item) => item.description).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)));
  const months = $derived([...new Set(filtered.map((invoice) => invoice.invoiceDate.slice(0, 7)))].sort((a, b) => b.localeCompare(a)));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthInvoices = $derived(all.filter((invoice) => invoice.invoiceDate.startsWith(thisMonth)));
  const thisMonthTotal = $derived(thisMonthInvoices.reduce((sum, invoice) => sum + invoice.amount, 0));
  const allExpanded = $derived(filtered.length > 0 && filtered.every((invoice) => expanded[invoice.id]));
  function toggleAll() {
    if (allExpanded) expanded = {};
    else expanded = Object.fromEntries(filtered.map((invoice) => [invoice.id, true]));
  }
</script>

{#if $invoices.isPending}
  <EmptyState title="載入發票中" body="正在從 D1 讀取發票記錄。" />
{:else if $invoices.isError}
  <EmptyState title="無法載入發票" body="請稍後再試。" />
{:else}
  <section class="grid gap-4">
    <div class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-xs"><p class="text-xs text-ink/50">本月消費</p><p class="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(thisMonthTotal)}</p><p class="text-xs text-ink/40">{thisMonthInvoices.length} 張發票</p></div>
      <div class="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-xs"><p class="text-xs text-ink/50">發票總數</p><p class="mt-1 text-xl font-semibold tabular-nums">{all.length.toLocaleString()}</p><p class="text-xs text-ink/40">張</p></div>
      <div class="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-xs"><p class="text-xs text-ink/50">本月均消</p><p class="mt-1 text-xl font-semibold tabular-nums">{thisMonthInvoices.length > 0 ? formatCurrency(thisMonthTotal / thisMonthInvoices.length) : "—"}</p><p class="text-xs text-ink/40">每張平均</p></div>
    </div>

    <div class="flex gap-2">
      <div class="relative min-w-0 flex-1"><Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input class="h-11 pl-9" placeholder="搜尋商店、發票號碼或品項" bind:value={search} /></div>
      {#if filtered.length > 0}<Button class="h-11" variant="outline" onclick={toggleAll}>{allExpanded ? "全部收合" : "全部展開"}</Button>{/if}
    </div>

    {#if months.length === 0}
      <EmptyState title={search.trim() ? "無符合結果" : "尚無發票記錄"} body={search.trim() ? "請調整搜尋條件。" : "同步電子發票連接器後顯示。"} />
    {:else}
      <div class="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-xs">
        {#each months as month (month)}
          {@const group = filtered.filter((invoice) => invoice.invoiceDate.startsWith(month))}
          <div>
            <div class="flex items-center justify-between border-b border-ink/8 bg-paper px-4 py-2"><span class="text-xs font-semibold text-ink/55">{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</span><span class="text-xs font-semibold tabular-nums text-ink/55">{formatCurrency(group.reduce((sum, invoice) => sum + invoice.amount, 0))}</span></div>
            <div class="divide-y divide-ink/8">
              {#each group as invoice (invoice.id)}
                <div>
                  <button class={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${expanded[invoice.id] ? "bg-blue-50" : "hover:bg-ink/3"}`} onclick={() => expanded[invoice.id] = !expanded[invoice.id]}>
                    <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{invoice.sellerName ?? "未知商家"}</p><p class="text-xs text-ink/45">{formatDate(invoice.invoiceDate)}{invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}</p></div>
                    <div class="flex shrink-0 items-center gap-2 text-right"><div><p class="text-sm font-semibold tabular-nums">{formatCurrency(invoice.amount)}</p>{#if invoice.items.length > 0}<p class="text-xs text-ink/40">{invoice.items.length} 項</p>{/if}</div><ChevronDown class={`size-4 text-ink/30 transition-transform ${expanded[invoice.id] ? "rotate-180" : ""}`} /></div>
                  </button>
                  {#if expanded[invoice.id]}
                    <div class="border-t border-ink/8 bg-paper/60">
                      {#if invoice.items.length > 0}
                        <div class="divide-y divide-ink/6">{#each invoice.items as item (item.id)}<div class="flex items-start gap-3 px-5 py-2.5"><div class="min-w-0 flex-1"><p class="text-sm text-ink/80">{item.description}</p>{#if item.quantity != null || item.unitPrice != null}<p class="mt-0.5 text-xs text-ink/45">{item.quantity != null ? `${item.quantity.toLocaleString()} × ` : ""}{item.unitPrice != null ? formatCurrency(item.unitPrice) : ""}</p>{/if}</div><p class="shrink-0 text-sm font-medium tabular-nums">{formatCurrency(item.amount)}</p></div>{/each}</div>
                      {:else}<p class="px-5 py-3 text-xs text-ink/40">無品項記錄</p>{/if}
                      <div class="flex items-center justify-between border-t border-ink/8 px-5 py-2.5"><p class="text-xs font-semibold text-ink/50">合計</p><p class="text-sm font-bold tabular-nums">{formatCurrency(invoice.amount)}</p></div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}
