<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { Search, Building2, CreditCard, FileText, TrendingUp } from "@lucide/svelte";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import ActivityCategoryChart from "./ActivityCategoryChart.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { ActivityItem, BankData, ExchangeRateRow, InvoiceRow, InvestmentTransactionRow, View } from "../lib/types";
  import { buildActivityCategorySlices, activityCashAmountTwd } from "../lib/activity-chart";
  import { formatCurrency, formatDate, rateMap } from "../lib/format.svelte";
  let { api, navigate }: { api: ApiClient; navigate: (view: View) => void } = $props();
  const bank = createQuery<BankData>({ queryKey: queryKeys.bank, queryFn: () => api.get<BankData>("/api/bank") });
  const invoices = createQuery<InvoiceRow[]>({ queryKey: queryKeys.invoices, queryFn: () => api.get<InvoiceRow[]>("/api/invoices") });
  const trades = createQuery<InvestmentTransactionRow[]>({ queryKey: queryKeys.investmentTransactions, queryFn: () => api.get<InvestmentTransactionRow[]>("/api/investment-transactions") });
  const rates = createQuery<ExchangeRateRow[]>({ queryKey: queryKeys.exchangeRates, queryFn: () => api.get<ExchangeRateRow[]>("/api/exchange-rates") });
  const qc = useQueryClient();
  let source = $state<"all" | ActivityItem["source"]>("all");
  let search = $state("");
  let selectedMonth = $state(new Date().toISOString().slice(0, 7));
  let selectedCategory = $state<{ flow: "income" | "expense"; category: string } | null>(null);
  let pending = $state<{ item: ActivityItem; categoryId: string; addRule: boolean; pattern: string; operator: "contains" | "equals" } | null>(null);
  const categories: Record<string, string> = { salary: "薪資", transfer: "轉帳", food: "餐飲", transport: "交通", shopping: "購物", housing: "居住", health: "醫療", education: "教育", entertainment: "娛樂", investment: "投資", insurance: "保險", fee: "費用", tax: "稅務", other: "其他" };
  const rateValues = $derived(rateMap($rates.data));
  const bankAccounts = $derived(new Map(($bank.data?.accounts ?? []).map((account) => [account.id, account])));
  const rawItems = $derived<ActivityItem[]>([
    ...($bank.data?.transactions ?? []).map((t) => {
      const account = bankAccounts.get(t.accountId);
      const isCard = account?.accountType === "credit" || t.accountType === "credit";
      return { id: t.id, source: isCard ? "card" as const : "bank" as const, date: t.postedDate ?? t.authorizedAt ?? "", title: t.description ?? t.counterparty ?? "銀行交易", subtitle: t.institutionName ?? account?.institutionName ?? t.accountName ?? account?.accountName ?? "", amount: t.amount, currency: t.currency, category: t.classification?.label ?? "其他", categoryId: t.classification?.categoryId ?? "other", transactionId: t.id, status: t.status };
    }),
    ...($invoices.data ?? []).map((i) => ({ id: i.id, source: "invoice" as const, date: i.invoiceDate, title: i.sellerName ?? "電子發票", subtitle: i.invoiceNumber ?? "", amount: i.amount, currency: "TWD", category: "發票", status: "已開立" })),
    ...($trades.data ?? []).map((t) => ({ id: t.id, source: "investment" as const, date: t.tradeDate ?? t.postedDate ?? "", title: t.name ?? t.symbol ?? "投資交易", subtitle: t.transactionName ?? t.transactionCode ?? "", amount: t.amount, currency: t.currency, category: "投資", status: "已完成" }))
  ]);
  const months = $derived([...new Set(rawItems.map((i) => i.date.slice(0, 7)).filter(Boolean).concat([new Date().toISOString().slice(0, 7)]))].sort((a, b) => b.localeCompare(a)).slice(0, 12));
  const monthlyCashItems = $derived(rawItems.filter((item) => item.date.startsWith(selectedMonth) && (item.source === "bank" || item.source === "card")));
  const incomeSlices = $derived(buildActivityCategorySlices(monthlyCashItems, "income", rateValues));
  const expenseSlices = $derived(buildActivityCategorySlices(monthlyCashItems, "expense", rateValues));
  const incomeTotal = $derived(incomeSlices.reduce((sum, slice) => sum + slice.amount, 0));
  const expenseTotal = $derived(expenseSlices.reduce((sum, slice) => sum + slice.amount, 0));
  const filtered = $derived(rawItems.filter((item) => {
    const amount = activityCashAmountTwd(item, rateValues);
    const matchesFlow = !selectedCategory || (selectedCategory.flow === "income" ? amount > 0 : amount < 0);
    return (source === "all" || item.source === source)
      && item.date.startsWith(selectedMonth)
      && (!search.trim() || `${item.title} ${item.subtitle} ${item.category}`.toLowerCase().includes(search.toLowerCase()))
      && (!selectedCategory || (item.category === selectedCategory.category && matchesFlow));
  }));
  const categoryMutation = createMutation({ mutationFn: async (payload: { transactionId: string; categoryId: string; addRule: boolean; pattern: string; operator: "contains" | "equals" }) => { await api.put(`/api/classification/overrides/bank_transaction/${payload.transactionId}`, { categoryId: payload.categoryId }); if (payload.addRule) await api.post("/api/classification/rules", { categoryId: payload.categoryId, targetType: "bank_transaction", field: "any_text", operator: payload.operator, pattern: payload.pattern.trim(), priority: 200, description: "由活動頁建立" }); }, onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.bank }); qc.invalidateQueries({ queryKey: queryKeys.classificationRules }); pending = null; } });
  function openCategory(item: ActivityItem, categoryId: string) { if (item.transactionId && categoryId !== item.categoryId) pending = { item, categoryId, addRule: false, pattern: item.title, operator: "contains" }; }
  function chooseCategory(flow: "income" | "expense", category: string) { selectedCategory = selectedCategory?.flow === flow && selectedCategory.category === category ? null : { flow, category }; }
  function countMatches() { if (!pending) return 0; return ($bank.data?.transactions ?? []).filter((t) => `${t.description ?? ""} ${t.counterparty ?? ""}`.toLowerCase().includes(pending!.pattern.toLowerCase())).length; }
</script>

{#if $bank.isPending || $invoices.isPending || $trades.isPending}<EmptyState title="載入活動中" body="正在整理銀行、投資與發票資料。" />{:else}
  <div class="grid min-w-0 max-w-full gap-5 overflow-x-clip">
    <div class="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
      <div class="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">收入</p><p class="mt-2 truncate text-xl font-bold text-moss">{formatCurrency(incomeTotal)}</p></div>
      <div class="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">支出</p><p class="mt-2 truncate text-xl font-bold text-coral">{formatCurrency(expenseTotal)}</p></div>
      <div class="hidden rounded-xl border border-ink/10 bg-white p-4 shadow-xs md:block"><p class="text-xs text-ink/45">活動筆數</p><p class="mt-2 text-xl font-bold">{filtered.length}</p></div>
      <div class="hidden rounded-xl border border-ink/10 bg-white p-4 shadow-xs md:block"><p class="text-xs text-ink/45">待分類</p><p class="mt-2 text-xl font-bold">{rawItems.filter((i) => (i.source === "bank" || i.source === "card") && i.categoryId === "other").length}</p></div>
    </div>

    <section class="grid min-w-0 gap-3">
      <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0"><h2 class="text-lg font-semibold">每月分類比例</h2><p class="mt-1 text-xs text-ink/45">收入與支出分開計算，發票不重複列入</p></div>
        <select aria-label="選擇活動月份" class="min-h-11 w-full min-w-0 rounded-xl border border-ink/10 bg-white px-3 text-sm font-semibold text-ink shadow-xs outline-hidden sm:w-auto sm:shrink-0" bind:value={selectedMonth}>{#each months as month}<option value={month}>{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</option>{/each}</select>
      </div>
      <div class="grid min-w-0 gap-3 lg:grid-cols-2">
        <ActivityCategoryChart flow="income" slices={incomeSlices} selectedCategory={selectedCategory?.flow === "income" ? selectedCategory.category : undefined} onSelect={(category) => chooseCategory("income", category)} />
        <ActivityCategoryChart flow="expense" slices={expenseSlices} selectedCategory={selectedCategory?.flow === "expense" ? selectedCategory.category : undefined} onSelect={(category) => chooseCategory("expense", category)} />
      </div>
    </section>

    <Card class="min-w-0 max-w-full overflow-hidden"><CardHeader class="min-w-0 gap-3 border-b border-ink/8"><div class="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between"><div class="min-w-0"><h2 class="truncate text-lg font-semibold">{selectedCategory ? `${selectedMonth} · ${selectedCategory.category}` : `${selectedMonth}所有活動`}</h2><p class="text-xs text-ink/45">銀行、信用卡、投資與發票</p></div><label class="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-ink/10 bg-paper px-3 md:w-80"><Search class="size-4 shrink-0 text-ink/40" /><input class="min-w-0 flex-1 bg-transparent text-sm outline-hidden" placeholder="搜尋商家、帳戶、品項或分類" bind:value={search} /></label></div><div class="grid min-w-0 grid-cols-5 gap-1">{#each [{key:"all",label:"全部"},{key:"bank",label:"銀行"},{key:"card",label:"信用卡"},{key:"investment",label:"投資"},{key:"invoice",label:"發票"}] as filter}<button class={`min-h-10 min-w-0 truncate rounded-lg px-1 text-xs font-semibold ${source === filter.key ? "bg-ink text-white" : "bg-paper text-ink/55"}`} onclick={() => { source = filter.key as typeof source; selectedCategory = null; }}>{filter.label}</button>{/each}</div></CardHeader><CardContent class="min-w-0 p-0"><div class="min-w-0 divide-y divide-ink/8">{#if filtered.length === 0}<p class="p-8 text-center text-sm text-ink/50">沒有符合條件的活動。</p>{:else}{#each filtered.slice(0, 100) as item}<div class="flex min-w-0 items-center gap-3 px-4 py-3 md:px-5"><span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-steel/10 text-steel">{#if item.source === "bank"}<Building2 class="size-5" />{:else if item.source === "card"}<CreditCard class="size-5" />{:else if item.source === "invoice"}<FileText class="size-5" />{:else}<TrendingUp class="size-5" />{/if}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{item.title}</p><p class="mt-0.5 truncate text-xs text-ink/45">{item.subtitle} · {formatDate(item.date)}</p>{#if item.transactionId}<select aria-label={`更新 ${item.title} 分類`} class="mt-1 max-w-36 rounded-md border border-ink/10 bg-paper px-1 py-0.5 text-xs font-medium text-steel outline-hidden" value={item.categoryId} onchange={(e) => openCategory(item, (e.currentTarget as HTMLSelectElement).value)}>{#each Object.entries(categories) as [key, label]}<option value={key}>{label}</option>{/each}</select>{/if}</div><p class={`max-w-[42%] shrink-0 truncate text-sm font-semibold tabular-nums ${(item.amount ?? 0) < 0 ? "text-coral" : "text-moss"}`}>{item.amount == null ? "—" : `${(item.amount ?? 0) >= 0 ? "+" : ""}${formatCurrency(item.amount, item.currency)}`}</p></div>{/each}{/if}</div></CardContent></Card>
    <div class="flex justify-end"><Button variant="ghost" onclick={() => navigate("invoices")}>查看完整發票明細 →</Button></div>
    {#if pending}<div aria-modal="true" class="fixed inset-0 z-[70] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6" role="dialog"><div class="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-lg md:rounded-2xl md:p-6"><h2 class="text-xl font-semibold">更新活動分類</h2><p class="mt-1 text-sm text-ink/50">{pending.item.title} → {categories[pending.categoryId] ?? pending.categoryId}</p><label class="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-paper p-4"><input class="mt-1 size-4" type="checkbox" bind:checked={pending.addRule} /><span><span class="block font-semibold">同時新增分類規則</span><span class="mt-1 block text-xs text-ink/50">符合規則的活動之後會自動套用。</span></span></label>{#if pending.addRule}<div class="mt-4 grid gap-3 rounded-xl border border-steel/20 bg-steel/5 p-4"><select class="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm outline-hidden" bind:value={pending.operator}><option value="contains">交易文字包含</option><option value="equals">交易文字完全等於</option></select><input class="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm outline-hidden" bind:value={pending.pattern} /><p class="text-xs font-semibold text-steel">將更新 {countMatches()} 筆過去活動</p></div>{/if}<div class="mt-5 grid grid-cols-2 gap-3"><Button variant="secondary" onclick={() => pending = null}>取消</Button><Button disabled={$categoryMutation.isPending || (pending.addRule && !pending.pattern.trim())} onclick={() => $categoryMutation.mutate({ transactionId: pending!.item.transactionId!, categoryId: pending!.categoryId, addRule: pending!.addRule, pattern: pending!.pattern, operator: pending!.operator })}>{$categoryMutation.isPending ? "更新中…" : "更新分類"}</Button></div>{#if $categoryMutation.isError}<p class="mt-3 text-sm text-coral">更新失敗。</p>{/if}</div></div>{/if}
  </div>
{/if}
