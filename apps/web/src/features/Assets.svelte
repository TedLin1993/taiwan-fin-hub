<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { Building2, CreditCard, WalletCards } from "@lucide/svelte";
  import Card from "../components/ui/Card.svelte";
  import CardHeader from "../components/ui/CardHeader.svelte";
  import CardContent from "../components/ui/CardContent.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import Button from "../components/ui/Button.svelte";
  import type { ApiClient } from "../lib/api";
  import { queryKeys } from "../lib/api";
  import type { AssetSection, BankData, ExchangeRateRow, InvestmentRow, ManualAssetRow, View } from "../lib/types";
  import { formatBankAccountName, formatCurrency, formatDate, rateMap } from "../lib/format.svelte";
  let { api, navigate }: { api: ApiClient; navigate: (view: View) => void } = $props();
  const bank = createQuery<BankData>({ queryKey: queryKeys.bank, queryFn: () => api.get<BankData>("/api/bank") });
  const investments = createQuery<InvestmentRow[]>({ queryKey: queryKeys.investments, queryFn: () => api.get<InvestmentRow[]>("/api/investments") });
  const manual = createQuery<ManualAssetRow[]>({ queryKey: queryKeys.manualAssets, queryFn: () => api.get<ManualAssetRow[]>("/api/manual-assets") });
  const rates = createQuery<ExchangeRateRow[]>({ queryKey: queryKeys.exchangeRates, queryFn: () => api.get<ExchangeRateRow[]>("/api/exchange-rates") });
  let section = $state<AssetSection>("all");
  const bankData = $derived($bank.data ?? { accounts: [], transactions: [] });
  const rateValues = $derived(rateMap($rates.data));
  const deposits = $derived(bankData.accounts.filter((a) => a.accountType !== "credit"));
  const cards = $derived(bankData.accounts.filter((a) => a.accountType === "credit"));
  const bankTotal = $derived(deposits.reduce((sum, a) => sum + (a.balance ?? 0) * (a.currency === "TWD" ? 1 : rateValues[a.currency] ?? 0), 0));
  const investmentTotal = $derived(($investments.data ?? []).reduce((sum, a) => sum + (a.marketValue ?? 0) + (a.cashBalance ?? 0), 0));
  const manualTotal = $derived(($manual.data ?? []).reduce((sum, a) => sum + (a.value ?? 0), 0));
  const cardDebt = $derived(Math.abs(cards.reduce((sum, a) => sum + (a.balance ?? 0), 0)));
  const tabs: { key: AssetSection; label: string }[] = [{ key: "all", label: "全部" }, { key: "bank", label: "銀行" }, { key: "cards", label: "信用卡" }, { key: "investments", label: "投資" }, { key: "manual-assets", label: "其他資產" }];
  const loading = $derived($bank.isPending || $investments.isPending || $manual.isPending);
</script>

{#if loading}<EmptyState title="載入資產中" body="正在讀取資產資料。" />{:else}
  <div class="grid gap-5">
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"><div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">銀行與現金</p><p class="mt-2 text-xl font-bold">{formatCurrency(bankTotal)}</p></div><div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">信用卡負債</p><p class="mt-2 text-xl font-bold text-coral">{formatCurrency(-cardDebt)}</p></div><div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">投資</p><p class="mt-2 text-xl font-bold">{formatCurrency(investmentTotal)}</p></div><div class="rounded-xl border border-ink/10 bg-white p-4 shadow-xs"><p class="text-xs text-ink/45">其他資產</p><p class="mt-2 text-xl font-bold text-moss">{formatCurrency(manualTotal)}</p></div></div>
    <div class="grid grid-cols-5 gap-1 rounded-xl bg-white p-1 shadow-xs">{#each tabs as tab}<button class={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold transition sm:text-sm ${section === tab.key ? "bg-ink text-white" : "text-ink/55 hover:bg-ink/5"}`} onclick={() => section = tab.key}>{tab.label}</button>{/each}</div>
    {#if section === "all" || section === "bank"}<Card><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><Building2 class="size-5 text-steel" />銀行帳戶</h2><Button size="sm" variant="ghost" onclick={() => navigate("bank")}>查看交易 →</Button></CardHeader><CardContent>{#if deposits.length === 0}<p class="py-8 text-center text-sm text-ink/45">尚無銀行帳戶。</p>{:else}<div class="grid gap-2 md:grid-cols-2">{#each deposits as account}<div class="rounded-xl border border-ink/8 bg-white p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="truncate font-semibold">{account.institutionName ?? account.connectorId} · {account.currency}</p><p class="mt-1 truncate text-xs text-ink/45">{formatBankAccountName(account)} · {account.asOfAt ? `更新 ${formatDate(account.asOfAt)}` : "尚未同步"}</p></div><p class="shrink-0 font-bold tabular-nums text-moss">{formatCurrency(account.balance ?? 0, account.currency)}</p></div></div>{/each}</div>{/if}</CardContent></Card>{/if}
    {#if section === "all" || section === "cards"}<Card><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><CreditCard class="size-5 text-steel" />信用卡</h2><Button size="sm" variant="ghost" onclick={() => navigate("cards")}>查看刷卡紀錄 →</Button></CardHeader><CardContent>{#if cards.length === 0}<p class="py-8 text-center text-sm text-ink/45">尚無信用卡資料。</p>{:else}<div class="grid gap-3 md:grid-cols-2">{#each cards as card}<button class="w-full rounded-2xl bg-ink p-4 text-left text-white" onclick={() => navigate("cards")}><div class="flex items-start justify-between"><div><p class="font-semibold">{card.institutionName ?? card.connectorId}</p><p class="mt-2 text-xs text-white/65">{card.accountName ?? formatBankAccountName(card)}</p></div><CreditCard class="size-5 text-white/70" /></div><p class="mt-5 text-2xl font-bold">{formatCurrency(Math.abs(card.balance ?? 0), card.currency)}</p></button>{/each}</div>{/if}</CardContent></Card>{/if}
    {#if section === "all" || section === "investments"}<Card><CardHeader class="flex-row items-center justify-between"><h2 class="flex items-center gap-2 text-lg font-semibold"><WalletCards class="size-5 text-steel" />投資持倉</h2><Button size="sm" variant="ghost" onclick={() => navigate("investments")}>查看交易 →</Button></CardHeader><CardContent>{#if ($investments.data ?? []).length === 0}<p class="py-8 text-center text-sm text-ink/45">尚無投資持倉。</p>{:else}<div class="divide-y divide-ink/8">{#each $investments.data ?? [] as item}<button class="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-left" onclick={() => navigate("investments")}><div class="min-w-0"><p class="truncate font-semibold">{item.symbol ? `${item.symbol} ` : ""}{item.name}</p><p class="mt-1 text-xs text-ink/45">{item.quantity ?? 0} 單位 · {item.assetType.toUpperCase()}</p></div><p class="shrink-0 font-bold tabular-nums text-steel">{formatCurrency((item.marketValue ?? 0) + (item.cashBalance ?? 0), item.currency)}</p></button>{/each}</div>{/if}</CardContent></Card>{/if}
    {#if section === "all" || section === "manual-assets"}<Card><CardHeader class="flex-row items-center justify-between"><h2 class="text-lg font-semibold">其他資產</h2><Button size="sm" variant="ghost" onclick={() => navigate("manual-assets")}>＋ 新增資產</Button></CardHeader><CardContent>{#if ($manual.data ?? []).length === 0}<p class="py-8 text-center text-sm text-ink/45">尚無其他資產。</p>{:else}<div class="divide-y divide-ink/8">{#each $manual.data ?? [] as item}<button class="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-left" onclick={() => navigate("manual-assets")}><div class="min-w-0"><p class="truncate font-semibold">{item.name}</p><p class="mt-1 truncate text-xs text-ink/45">{item.category} · {item.date ? `${formatDate(item.date)} 更新` : "查看估值歷史"}</p></div><p class="shrink-0 font-bold tabular-nums text-moss">{formatCurrency(item.value ?? 0)}</p></button>{/each}</div>{/if}</CardContent></Card>{/if}
  </div>
{/if}
