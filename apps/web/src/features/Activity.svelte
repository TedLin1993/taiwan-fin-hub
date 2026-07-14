<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { Search, Building2, CreditCard, FileText, TrendingUp } from "@lucide/svelte";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import Button from "../components/ui/Button.svelte";
  import Checkbox from "../components/ui/Checkbox.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import Badge from "../components/ui/Badge.svelte";
  import Input from "../components/ui/Input.svelte";
  import Select from "../components/ui/Select.svelte";
  import TabsList from "../components/ui/TabsList.svelte";
  import TabsTrigger from "../components/ui/TabsTrigger.svelte";
  import ActivityCategoryChart from "./ActivityCategoryChart.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { ActivityItem, BankData, ExchangeRateRow, InvoiceRow, InvestmentTransactionRow, View } from "../lib/types";
  import { buildActivityCategorySlices, activityCashAmountTwd } from "../lib/activity-chart";
  import { formatCompactTwd, formatCurrency, formatDate, formatNumber, normalizeFinancialDate, rateMap } from "../lib/format.svelte";
  let { api, navigate }: { api: ApiClient; navigate: (view: View) => void } = $props();
  const bank = createQuery<BankData>({ queryKey: queryKeys.bank, queryFn: () => api.get<BankData>("/api/bank") });
  const invoices = createQuery<InvoiceRow[]>({ queryKey: queryKeys.invoices, queryFn: () => api.get<InvoiceRow[]>("/api/invoices") });
  const trades = createQuery<InvestmentTransactionRow[]>({ queryKey: queryKeys.investmentTransactions, queryFn: () => api.get<InvestmentTransactionRow[]>("/api/investment-transactions") });
  const rates = createQuery<ExchangeRateRow[]>({ queryKey: queryKeys.exchangeRates, queryFn: () => api.get<ExchangeRateRow[]>("/api/exchange-rates") });
  const qc = useQueryClient();
  let source = $state<"all" | "bank" | "card" | "invoice">("all");
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
    ...($trades.data ?? []).map((t) => ({ id: t.id, source: "investment" as const, date: normalizeFinancialDate(t.tradeDate ?? t.postedDate), title: t.name ?? t.symbol ?? "投資交易", subtitle: [t.transactionName ?? t.transactionCode, t.quantity != null ? `${formatNumber(t.quantity)} 股` : undefined].filter(Boolean).join(" · "), amount: t.price === 1 ? undefined : t.amount, currency: t.currency, category: "投資", status: "已完成" }))
  ].sort((a, b) => b.date.localeCompare(a.date)));
  const months = $derived([...new Set(rawItems.map((i) => i.date.slice(0, 7)).filter(Boolean).concat([new Date().toISOString().slice(0, 7)]))].sort((a, b) => b.localeCompare(a)).slice(0, 12));
  const monthlyCashItems = $derived(rawItems.filter((item) => item.date.startsWith(selectedMonth) && (item.source === "bank" || item.source === "card")));
  const incomeSlices = $derived(buildActivityCategorySlices(monthlyCashItems, "income", rateValues));
  const expenseSlices = $derived(buildActivityCategorySlices(monthlyCashItems, "expense", rateValues));
  const incomeTotal = $derived(incomeSlices.reduce((sum, slice) => sum + slice.amount, 0));
  const expenseTotal = $derived(expenseSlices.reduce((sum, slice) => sum + slice.amount, 0));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const selectedMonthLabel = $derived(`${Number(selectedMonth.slice(5))} 月`);
  const pendingCount = $derived(rawItems.filter((item) => (item.source === "bank" || item.source === "card") && (item.status === "pending" || item.categoryId === "other")).length);
  const cashFlowMonths = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    return date.toISOString().slice(0, 7);
  });
  const cashFlow = $derived(cashFlowMonths.map((month) => {
    const items = rawItems.filter((item) => item.date.startsWith(month) && (item.source === "bank" || item.source === "card"));
    return {
      month,
      income: items.reduce((sum, item) => sum + Math.max(activityCashAmountTwd(item, rateValues), 0), 0),
      expense: Math.abs(items.reduce((sum, item) => sum + Math.min(activityCashAmountTwd(item, rateValues), 0), 0))
    };
  }));
  const maxCashFlow = $derived(Math.max(...cashFlow.flatMap((point) => [point.income, point.expense]), 1));
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
  function chooseMonth(month: string) { selectedMonth = month; selectedCategory = null; }
  function sourceLabel(source: ActivityItem["source"]) { return { bank: "銀行", card: "信用卡", investment: "投資", invoice: "發票" }[source]; }
  function renderedAmount(item: ActivityItem) { return item.source === "card" ? -Math.abs(item.amount ?? 0) : item.amount; }
  function countMatches() { if (!pending) return 0; return ($bank.data?.transactions ?? []).filter((t) => `${t.description ?? ""} ${t.counterparty ?? ""}`.toLowerCase().includes(pending!.pattern.toLowerCase())).length; }
</script>

{#if $bank.isPending || $invoices.isPending || $trades.isPending}<EmptyState title="載入活動中" body="正在整理銀行、投資與發票資料。" />{:else}
  <div class="grid min-w-0 max-w-full gap-5 overflow-x-clip">
    <div class="hidden min-w-0 grid-cols-2 gap-3 md:grid md:grid-cols-4 md:gap-4">
      <Card><CardContent class="p-5"><p class="text-xs font-semibold text-ink/50">{selectedMonthLabel}收入</p><p class="mt-2 truncate text-2xl font-bold text-moss">+{formatCurrency(incomeTotal)}</p><p class="mt-1 text-xs text-ink/45">銀行與信用卡活動</p></CardContent></Card>
      <Card><CardContent class="p-5"><p class="text-xs font-semibold text-ink/50">{selectedMonthLabel}支出</p><p class="mt-2 truncate text-2xl font-bold text-coral">−{formatCurrency(expenseTotal)}</p><p class="mt-1 text-xs text-ink/45">不重複計入發票</p></CardContent></Card>
      <Card><CardContent class="p-5"><p class="text-xs font-semibold text-ink/50">{selectedMonthLabel}淨流入</p><p class={`mt-2 truncate text-2xl font-bold ${incomeTotal >= expenseTotal ? "text-moss" : "text-coral"}`}>{formatCurrency(incomeTotal - expenseTotal)}</p><p class="mt-1 text-xs text-ink/45">收入 − 支出</p></CardContent></Card>
      <Card><CardContent class="p-5"><p class="text-xs font-semibold text-ink/50">待分類</p><p class="mt-2 text-2xl font-bold">{pendingCount} 筆</p><p class="mt-1 text-xs text-ink/45">銀行交易</p></CardContent></Card>
    </div>

    <section class="grid min-w-0 gap-3">
      <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0"><h2 class="text-lg font-semibold">每月分類比例</h2><p class="mt-1 text-xs text-ink/45">收入與支出分開計算，發票不重複列入</p></div>
        <Select aria-label="選擇活動月份" class="h-11 w-full min-w-0 font-semibold sm:w-auto sm:shrink-0" value={selectedMonth} onchange={(event: Event) => chooseMonth((event.currentTarget as HTMLSelectElement).value)}>{#each months as month}<option value={month}>{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</option>{/each}</Select>
      </div>
      <div class="grid min-w-0 gap-3 lg:grid-cols-2">
        <ActivityCategoryChart flow="income" slices={incomeSlices} selectedCategory={selectedCategory?.flow === "income" ? selectedCategory.category : undefined} onSelect={(category) => chooseCategory("income", category)} />
        <ActivityCategoryChart flow="expense" slices={expenseSlices} selectedCategory={selectedCategory?.flow === "expense" ? selectedCategory.category : undefined} onSelect={(category) => chooseCategory("expense", category)} />
      </div>
    </section>

    <Card class="hidden md:block">
      <CardHeader class="flex-row items-center justify-between"><h2 class="text-lg font-semibold">現金流趨勢</h2><Badge variant="secondary">6 個月　收入／支出</Badge></CardHeader>
      <CardContent>
        <div class="grid grid-cols-6 gap-3">
          {#each cashFlow as point}
            <button aria-pressed={selectedMonth === point.month} class={`grid min-w-0 rounded-xl px-2 pb-2 pt-3 transition ${selectedMonth === point.month ? "bg-steel/10 ring-2 ring-steel/30" : "hover:bg-paper"}`} onclick={() => chooseMonth(point.month)}>
              <div class="flex h-28 items-end justify-center gap-2"><span class="w-1/3 rounded-t-lg bg-emerald-700" style={`height:${Math.max(8, point.income / maxCashFlow * 100)}%`}></span><span class="w-1/3 rounded-t-lg bg-coral" style={`height:${Math.max(8, point.expense / maxCashFlow * 100)}%`}></span></div>
              <span class="mt-2 text-xs font-semibold">{Number(point.month.slice(5))} 月</span><span class="mt-1 truncate text-[10px] text-moss">+{formatCompactTwd(point.income)}</span><span class="truncate text-[10px] text-coral">−{formatCompactTwd(point.expense)}</span>
            </button>
          {/each}
        </div>
        <div class="mt-3 flex items-center justify-between text-xs text-ink/45"><span><span class="text-emerald-700">■</span> 收入　<span class="text-coral">■</span> 支出</span><button class="font-semibold text-steel" onclick={() => chooseMonth(currentMonth)}>回到本月</button></div>
      </CardContent>
    </Card>

    <Card class="min-w-0 max-w-full overflow-hidden">
      <CardHeader class="min-w-0 gap-3 border-b border-ink/8">
        <div class="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between"><div class="min-w-0"><h2 class="truncate text-lg font-semibold">{selectedCategory ? `${selectedMonthLabel} · ${selectedCategory.category}` : `${selectedMonthLabel}所有活動`}</h2><p class="text-xs text-ink/45">銀行、信用卡、投資與發票</p></div><div class="relative md:w-80"><Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input class="h-11 pl-9" placeholder="搜尋商家、帳戶、品項或分類" bind:value={search} /></div></div>
        {#if selectedCategory}<div class="flex items-center justify-between rounded-lg bg-steel/10 px-3 py-2 text-sm"><span><strong>{selectedCategory.category}</strong> · {selectedCategory.flow === "income" ? "收入" : "支出"}</span><button class="min-h-8 px-2 text-xs font-semibold text-steel" onclick={() => selectedCategory = null}>顯示全部</button></div>{/if}
        <TabsList class="grid h-auto w-full grid-cols-4">{#each [{key:"all",label:"全部"},{key:"bank",label:"銀行"},{key:"card",label:"信用卡"},{key:"invoice",label:"發票"}] as filter}<TabsTrigger class={`min-h-9 min-w-0 px-1 text-xs md:text-sm ${source === filter.key ? "bg-ink text-white" : ""}`} active={source === filter.key} onclick={() => { source = filter.key as typeof source; selectedCategory = null; }}>{filter.label}</TabsTrigger>{/each}</TabsList>
      </CardHeader>
      <CardContent class="min-w-0 p-0">
        <div class="min-w-0 divide-y divide-ink/8 md:hidden">
          {#if filtered.length === 0}<p class="p-8 text-center text-sm text-ink/50">沒有符合條件的活動。</p>{:else}{#each filtered.slice(0, 100) as item}{@const amount = renderedAmount(item)}<div class="flex min-w-0 items-center gap-3 px-4 py-3"><span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-steel/10 text-steel">{#if item.source === "bank"}<Building2 class="size-5" />{:else if item.source === "card"}<CreditCard class="size-5" />{:else if item.source === "invoice"}<FileText class="size-5" />{:else}<TrendingUp class="size-5" />{/if}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{item.title}</p><p class="mt-0.5 truncate text-xs text-ink/45">{sourceLabel(item.source)} · {formatDate(item.date)}</p>{#if item.transactionId}<Select aria-label={`更新 ${item.title} 分類`} class="mt-1 h-8 max-w-36 px-2 py-1 text-xs font-medium text-steel" value={item.categoryId} onchange={(e: Event) => openCategory(item, (e.currentTarget as HTMLSelectElement).value)}>{#each Object.entries(categories) as [key, label]}<option value={key}>{label}</option>{/each}</Select>{/if}</div><p class={`max-w-[42%] shrink-0 truncate text-sm font-semibold tabular-nums ${(amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}>{amount == null ? "—" : `${amount >= 0 && item.source !== "invoice" ? "+" : ""}${formatCurrency(amount, item.currency)}`}</p></div>{/each}{/if}
        </div>
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full min-w-[820px] text-left text-sm"><thead class="bg-paper text-xs font-semibold text-ink/45"><tr><th class="px-5 py-3">日期</th><th class="px-4 py-3">來源</th><th class="px-4 py-3">說明／商家</th><th class="px-4 py-3">分類</th><th class="px-4 py-3 text-right">金額</th><th class="px-5 py-3">狀態</th></tr></thead><tbody class="divide-y divide-ink/8">{#if filtered.length === 0}<tr><td class="px-5 py-8 text-center text-ink/50" colspan="6">沒有符合條件的活動。</td></tr>{:else}{#each filtered.slice(0, 100) as item}{@const amount = renderedAmount(item)}<tr><td class="whitespace-nowrap px-5 py-3 text-ink/55">{formatDate(item.date)}</td><td class="px-4 py-3">{sourceLabel(item.source)}</td><td class="max-w-xs px-4 py-3"><p class="truncate font-semibold">{item.title}</p><p class="truncate text-xs text-ink/40">{item.subtitle}</p></td><td class="px-4 py-3">{#if item.transactionId}<Select aria-label={`更新 ${item.title} 分類`} class="h-9 w-auto px-2 text-sm font-medium text-steel" value={item.categoryId} onchange={(e: Event) => openCategory(item, (e.currentTarget as HTMLSelectElement).value)}>{#each Object.entries(categories) as [key, label]}<option value={key}>{label}</option>{/each}</Select>{:else}{item.category}{/if}</td><td class={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${(amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}>{amount == null ? "—" : formatCurrency(amount, item.currency)}</td><td class="whitespace-nowrap px-5 py-3 text-ink/55">{item.status === "pending" ? "待入帳" : item.status === "posted" ? "已入帳" : item.status}</td></tr>{/each}{/if}</tbody></table>
        </div>
      </CardContent>
    </Card>
    <div class="flex justify-end"><Button variant="ghost" onclick={() => navigate("invoices")}>查看完整發票明細 →</Button></div>
    {#if pending}<div aria-modal="true" class="fixed inset-0 z-[70] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6" role="dialog"><div class="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-lg md:rounded-2xl md:p-6"><h2 class="text-xl font-semibold">更新活動分類</h2><p class="mt-1 text-sm text-ink/50">{pending.item.title} → {categories[pending.categoryId] ?? pending.categoryId}</p><label class="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-paper p-4"><Checkbox class="mt-1" checked={pending.addRule} onchange={(e: Event) => pending!.addRule = (e.currentTarget as HTMLInputElement).checked} /><span><span class="block font-semibold">同時新增分類規則</span><span class="mt-1 block text-xs text-ink/50">符合規則的活動之後會自動套用。</span></span></label>{#if pending.addRule}<div class="mt-4 grid gap-3 rounded-xl border border-steel/20 bg-steel/5 p-4"><Select bind:value={pending.operator}><option value="contains">交易文字包含</option><option value="equals">交易文字完全等於</option></Select><Input bind:value={pending.pattern} /><p class="text-xs font-semibold text-steel">將更新 {countMatches()} 筆過去活動</p></div>{/if}<div class="mt-5 grid grid-cols-2 gap-3"><Button variant="secondary" onclick={() => pending = null}>取消</Button><Button disabled={$categoryMutation.isPending || (pending.addRule && !pending.pattern.trim())} onclick={() => $categoryMutation.mutate({ transactionId: pending!.item.transactionId!, categoryId: pending!.categoryId, addRule: pending!.addRule, pattern: pending!.pattern, operator: pending!.operator })}>{$categoryMutation.isPending ? "更新中…" : "更新分類"}</Button></div>{#if $categoryMutation.isError}<p class="mt-3 text-sm text-coral">更新失敗。</p>{/if}</div></div>{/if}
  </div>
{/if}
