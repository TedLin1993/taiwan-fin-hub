<script lang="ts">
  import { onMount } from "svelte";
  import { toStore } from "svelte/store";
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import {
    Database,
    KeyRound,
    RefreshCw,
    Save,
    WalletCards,
  } from "@lucide/svelte";
  import Card from "../../components/ui/Card.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Checkbox from "../../components/ui/Checkbox.svelte";
  import Input from "../../components/ui/Input.svelte";
  import Select from "../../components/ui/Select.svelte";
  import TimePicker from "../../components/ui/TimePicker.svelte";
  import type { ApiClient } from "../../lib/api";
  import { queryKeys } from "../../lib/api";
  import {
    connectorSettingsQuery,
    syncJobsQuery,
    syncScheduleQuery,
  } from "../../lib/queries";
  import type {
    ConnectorField,
    ConnectorId,
    SyncTarget,
  } from "../../lib/types";
  import { formatDateTime } from "../../lib/format.svelte";

  let {
    api,
    connectorId,
    demoMode,
    title,
    fields,
    embedded = false,
  }: {
    api: ApiClient;
    connectorId: ConnectorId;
    demoMode: boolean;
    title: string;
    fields: ConnectorField[];
    embedded?: boolean;
  } = $props();
  const qc = useQueryClient();
  const settings = createQuery(
    toStore(() => connectorSettingsQuery(() => api, connectorId)),
  );
  const jobs = createQuery(syncJobsQuery(() => api));
  const defaultSchedule = createQuery(syncScheduleQuery(() => api));
  let values = $state<Record<string, string | boolean>>({});
  let error = $state("");
  let otp = $state("");
  let otpForced = $state(false);
  let sinopacCaptchaImage = $state("");
  let sinopacCaptcha = $state("");
  let pendingSyncTarget = $state<SyncTarget>("default");
  const job = $derived(
    ($jobs.data ?? []).find(
      (j) => j.connectorId === connectorId && j.scope === "all",
    ),
  );
  const sinopacSessionAvailable = $derived(
    connectorId === "sinopac" && Boolean($settings.data?.sessionAvailable),
  );
  const intervalOptions = [
    { label: "每小時", minutes: 60 },
    { label: "每 6 小時", minutes: 360 },
    { label: "每 12 小時", minutes: 720 },
    { label: "每天", minutes: 1440 },
    { label: "每週", minutes: 10080 },
  ];
  const weekdayOptions = [
    "週日",
    "週一",
    "週二",
    "週三",
    "週四",
    "週五",
    "週六",
  ];

  onMount(() =>
    settings.subscribe((result) => {
      for (const [key, value] of Object.entries(
        result.data?.publicConfig ?? {},
      )) {
        if (values[key] === undefined)
          values[key] = typeof value === "boolean" ? value : String(value);
      }
      if (connectorId === "einvoice" && values.fetchDetails === undefined)
        values.fetchDetails = true;
    }),
  );

  const save = createMutation({
    mutationFn: (config: Record<string, unknown>) => {
      if (!Object.keys(config).length) throw new Error("請先填寫欄位再儲存。");
      return api.put(`/api/connectors/${connectorId}/settings`, { config });
    },
    onSuccess: () => {
      error = "";
      for (const field of fields) {
        if (field.type === "text" || field.type === "password")
          values[field.key] = "";
      }
      qc.invalidateQueries({
        queryKey: queryKeys.connectorSettings(connectorId),
      });
    },
    onError: (e) => (error = e instanceof Error ? e.message : "儲存失敗"),
  });
  const updateJob = createMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch(`/api/sync-jobs/${connectorId}/all`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.syncJobs }),
  });
  const sync = createMutation({
    mutationFn: (target: SyncTarget) => {
      if (demoMode) throw new Error("Demo site 已停用連接器同步。");
      const path =
        connectorId === "tdcc" && target !== "default"
          ? `/api/connectors/${connectorId}/sync/${target}`
          : `/api/connectors/${connectorId}/sync`;
      pendingSyncTarget = target;
      return api.post(
        path,
        connectorId === "einvoice" ? { fetchDetails: true } : undefined,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.syncJobs });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      if (connectorId === "einvoice")
        qc.invalidateQueries({ queryKey: queryKeys.invoices });
      else if (connectorId === "esun" || connectorId === "cathaybk")
        qc.invalidateQueries({ queryKey: queryKeys.bank });
      else if (connectorId === "sinopac") {
        qc.invalidateQueries({
          queryKey: queryKeys.connectorSettings(connectorId),
        });
        qc.invalidateQueries({ queryKey: queryKeys.bank });
        qc.invalidateQueries({ queryKey: queryKeys.bills });
      } else {
        if (
          pendingSyncTarget === "default" ||
          pendingSyncTarget === "investments"
        )
          qc.invalidateQueries({ queryKey: queryKeys.investments });
        if (pendingSyncTarget === "default" || pendingSyncTarget === "trades")
          qc.invalidateQueries({ queryKey: queryKeys.investmentTransactions });
        if (pendingSyncTarget === "default" || pendingSyncTarget === "bank")
          qc.invalidateQueries({ queryKey: queryKeys.bank });
      }
    },
    onError: (e) => {
      error = e instanceof Error ? e.message : "同步失敗";
      if (connectorId === "sinopac")
        qc.invalidateQueries({
          queryKey: queryKeys.connectorSettings(connectorId),
        });
    },
  });
  const prepareSinopac = createMutation({
    mutationFn: () => {
      if (demoMode) throw new Error("Demo site 已停用連接器同步。");
      return api.post<{ captchaImage: string; expiresAt: string }>(
        "/api/connectors/sinopac/captcha",
      );
    },
    onSuccess: (data) => {
      error = "";
      sinopacCaptcha = "";
      sinopacCaptchaImage = data.captchaImage;
    },
    onError: (e) => (error = e instanceof Error ? e.message : "取得驗證碼失敗"),
  });
  const verifySinopac = createMutation({
    mutationFn: () => {
      if (demoMode) throw new Error("Demo site 已停用連接器同步。");
      if (!/^\d{6}$/.test(sinopacCaptcha.trim()))
        throw new Error("請輸入圖片中的六位數字驗證碼。");
      return api.post("/api/connectors/sinopac/sync", {
        captcha: sinopacCaptcha.trim(),
      });
    },
    onSuccess: () => {
      error = "";
      sinopacCaptcha = "";
      sinopacCaptchaImage = "";
      qc.invalidateQueries({
        queryKey: queryKeys.connectorSettings(connectorId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.syncJobs });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      qc.invalidateQueries({ queryKey: queryKeys.bank });
      qc.invalidateQueries({ queryKey: queryKeys.bills });
      if (job && !job.enabled) $updateJob.mutate({ enabled: true });
    },
    onError: (e) => (error = e instanceof Error ? e.message : "驗證或同步失敗"),
  });
  const syncErrorMessage = $derived(
    $sync.error instanceof Error ? $sync.error.message : "",
  );
  const otpRequired = $derived(
    connectorId === "tdcc" && (otpForced || /OTP/i.test(syncErrorMessage)),
  );
  const otpChannel = $derived(/SMS/i.test(syncErrorMessage) ? "sms" : "email");
  const verifyOtp = createMutation({
    mutationFn: () => {
      if (demoMode) throw new Error("Demo site 已停用連接器同步。");
      if (!otp.trim()) throw new Error("請先輸入驗證碼。");
      const path =
        connectorId === "tdcc" && pendingSyncTarget !== "default"
          ? `/api/connectors/${connectorId}/sync/${pendingSyncTarget}`
          : `/api/connectors/${connectorId}/sync`;
      return api.post(path, { otp: otp.trim(), otpChannel });
    },
    onSuccess: () => {
      otp = "";
      otpForced = false;
      $sync.reset();
      qc.invalidateQueries({
        queryKey: queryKeys.connectorSettings(connectorId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.syncJobs });
      qc.invalidateQueries({ queryKey: queryKeys.summary });
      qc.invalidateQueries({ queryKey: queryKeys.investments });
      qc.invalidateQueries({ queryKey: queryKeys.investmentTransactions });
      qc.invalidateQueries({ queryKey: queryKeys.bank });
    },
    onError: (e) => (error = e instanceof Error ? e.message : "驗證失敗"),
  });

  function buildConfig() {
    const entries: Array<[string, string | number | boolean]> = [];
    for (const field of fields) {
      const raw = values[field.key];
      if (raw === undefined || raw === "") continue;
      if (field.type !== "number") {
        entries.push([field.key, raw]);
        continue;
      }
      const number = Number(raw);
      if (Number.isFinite(number)) entries.push([field.key, number]);
    }
    return Object.fromEntries(entries);
  }
  function intervalLabel(minutes: number) {
    return (
      intervalOptions.find((option) => option.minutes === minutes)?.label ??
      `${minutes} 分鐘`
    );
  }
</script>

<Card
  as="article"
  class={embedded
    ? "rounded-none border-0 bg-transparent p-0 shadow-none"
    : "p-4"}
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-lg font-semibold">
        {embedded ? "連線與同步" : title}
      </h2>
      <p class="text-sm text-ink/65">
        {$settings.data?.configured
          ? `已設定於 ${formatDateTime($settings.data.updatedAt)}。機密資料不會在此顯示；重新填寫欄位即可覆寫。`
          : "尚未設定"}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if connectorId === "tdcc"}
        <Button
          size="sm"
          disabled={demoMode}
          onclick={() => $sync.mutate("investments")}
          ><WalletCards class="size-4" />同步投資</Button
        >
        <Button
          size="sm"
          disabled={demoMode}
          onclick={() => $sync.mutate("bank")}
          ><RefreshCw class="size-4" />同步銀行</Button
        >
        <Button
          size="sm"
          disabled={demoMode}
          onclick={() => $sync.mutate("trades")}
          ><Database class="size-4" />同步交易</Button
        >
      {:else if connectorId === "sinopac"}
        {#if sinopacSessionAvailable}
          <Button
            size="sm"
            disabled={demoMode || $sync.isPending || $verifySinopac.isPending}
            onclick={() => {
              error = "";
              $sync.mutate("default");
            }}
            ><RefreshCw class="size-4" />{$sync.isPending
              ? "同步中…"
              : "同步"}</Button
          >
          <Button
            size="sm"
            variant="outline"
            disabled={demoMode ||
              $prepareSinopac.isPending ||
              $verifySinopac.isPending}
            onclick={() => {
              error = "";
              $prepareSinopac.mutate();
            }}
            ><KeyRound class="size-4" />{$prepareSinopac.isPending
              ? "取得中…"
              : "重新驗證"}</Button
          >
        {:else}
          <Button
            size="sm"
            disabled={demoMode ||
              $prepareSinopac.isPending ||
              $verifySinopac.isPending}
            onclick={() => {
              error = "";
              $prepareSinopac.mutate();
            }}
            ><KeyRound class="size-4" />{$prepareSinopac.isPending
              ? "取得中…"
              : "取得驗證碼"}</Button
          >
        {/if}
      {:else}
        <Button
          size="sm"
          disabled={demoMode}
          onclick={() => $sync.mutate("default")}
          ><RefreshCw class="size-4" />同步</Button
        >
      {/if}
      {#if connectorId === "tdcc"}<Button
          size="sm"
          variant="secondary"
          disabled={demoMode}
          onclick={() => (otpForced = true)}
          ><KeyRound class="size-4" />輸入 OTP</Button
        >{/if}
    </div>
  </div>
  {#if demoMode}<p
      class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      Demo site 已停用同步；你仍可查看示範資料與介面互動。
    </p>{/if}
  {#if connectorId === "tdcc"}<details
      class="mt-3 rounded-md border border-ink/10 bg-paper text-sm text-ink/70"
    >
      <summary
        class="cursor-pointer select-none px-3 py-2 font-medium text-ink/80"
        >使用說明</summary
      >
      <ol class="list-decimal space-y-1.5 px-3 pb-3 pt-1 pl-8">
        <li>先在手機下載並登入「集保e存摺」，確認可看到股票與基金資料。</li>
        <li>填入身分證字號與集保 App 密碼，儲存後再按同步。</li>
        <li>首次同步需要驗證碼，請查看手機簡訊或電子信箱。</li>
        <li>完成後即可看到持倉；日後同步通常不需重新輸入驗證碼。</li>
      </ol>
    </details>{/if}
  {#if connectorId === "sinopac"}<details
      class="mt-3 rounded-md border border-ink/10 bg-paper text-sm text-ink/70"
    >
      <summary
        class="cursor-pointer select-none px-3 py-2 font-medium text-ink/80"
        >使用說明</summary
      >
      <ol class="list-decimal space-y-1.5 px-3 pb-3 pt-1 pl-8">
        <li>先儲存身分證字號／統編、行動／網路銀行使用者代碼與網路密碼。</li>
        <li>
          首次或銀行 session 失效時，透過行動網銀頁面取得並輸入一次圖形驗證碼。
        </li>
        <li>
          驗證成功後會加密保存 session；信用卡總覽、近期帳單與未出帳消費皆直接由
          App JSON API 同步，不解析 MMA 頁面。
        </li>
        <li>
          後續手動與排程同步會自動續用 session，銀行強制登出時才需重新驗證。
        </li>
      </ol>
    </details>{/if}
  {#if connectorId === "sinopac" && sinopacCaptchaImage}
    <div class="mt-3 rounded-md border border-ink/10 bg-paper p-3">
      <p class="text-sm font-medium text-ink/80">
        請輸入圖片中的六位數字，驗證碼約兩分鐘內有效。
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <img
          src={sinopacCaptchaImage}
          alt="永豐圖形驗證碼"
          class="h-[70px] w-[200px] shrink-0 rounded border border-ink/25 bg-white object-fill shadow-sm"
        />
        <Input
          class="min-w-40 flex-1"
          inputmode="numeric"
          maxlength="6"
          placeholder="六位數字驗證碼"
          bind:value={sinopacCaptcha}
        />
        <Button
          size="sm"
          disabled={$verifySinopac.isPending}
          onclick={() => {
            error = "";
            $verifySinopac.mutate();
          }}
          ><RefreshCw class="size-4" />{$verifySinopac.isPending
            ? "同步中…"
            : "驗證並同步"}</Button
        >
        <Button
          size="sm"
          variant="outline"
          disabled={$prepareSinopac.isPending || $verifySinopac.isPending}
          onclick={() => $prepareSinopac.mutate()}>換一張</Button
        >
      </div>
    </div>
  {/if}
  <div class="mt-3 rounded-xl border border-ink/10 bg-paper p-3 text-sm">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink/70">
          <span class="font-semibold text-ink">
            自動同步：{job?.enabled ? "開" : "關"}
          </span>
          {#if connectorId === "sinopac"}<span
              >登入：{sinopacSessionAvailable
                ? "session 可自動續用"
                : "需要人工驗證"}</span
            >{/if}
          {#if job}<span
              >狀態：{job.running
                ? "同步中"
                : job.lastStatus === "success"
                  ? "正常"
                  : job.lastStatus === "failed"
                    ? "失敗"
                    : job.lastStatus === "needs_user_action"
                      ? "需要處理"
                      : "尚未同步"}</span
            >{/if}
        </div>
        {#if job?.lastRunAt}
          <p class="mt-1 text-xs text-muted-foreground">
            上次同步：{formatDateTime(job.lastRunAt)}
          </p>
        {/if}
      </div>
      {#if job}<Button
          size="sm"
          variant="outline"
          disabled={demoMode || $updateJob.isPending}
          onclick={() => $updateJob.mutate({ enabled: !job.enabled })}
          >{job.enabled ? "關閉" : "開啟"}</Button
        >{/if}
    </div>

    {#if job?.enabled}
      <div class="mt-3 grid gap-3 border-t border-ink/10 pt-3 md:grid-cols-4">
        <label class="grid gap-1 text-xs font-semibold text-ink/70">
          排程方式
          <Select
            value={job.scheduleMode ?? "custom"}
            disabled={demoMode || $updateJob.isPending}
            onchange={(event: Event) =>
              $updateJob.mutate({
                scheduleMode: (event.currentTarget as HTMLSelectElement).value,
              })}
          >
            <option value="inherit">跟隨預設</option>
            <option value="custom">自訂排程</option>
          </Select>
        </label>

        {#if job.scheduleMode === "inherit"}
          <div
            class="flex items-center rounded-lg border border-moss/15 bg-moss/5 px-3 py-2 text-sm text-moss md:col-span-3"
          >
            <span class="font-semibold">跟隨預設：</span>
            {#if $defaultSchedule.data}
              {#if $defaultSchedule.data.intervalMinutes === 10080}
                每{weekdayOptions[$defaultSchedule.data.preferredWeekday] ??
                  "週一"}
                {$defaultSchedule.data.preferredTime} 起
              {:else}
                {intervalLabel(
                  $defaultSchedule.data.intervalMinutes,
                )}{#if $defaultSchedule.data.intervalMinutes >= 1440}
                  {$defaultSchedule.data.preferredTime} 起{/if}
              {/if}
            {:else}
              讀取中…
            {/if}
          </div>
        {:else}
          <label class="grid gap-1 text-xs font-semibold text-ink/70">
            同步頻率
            <Select
              value={job.intervalMinutes}
              disabled={demoMode || $updateJob.isPending}
              onchange={(event: Event) =>
                $updateJob.mutate({
                  intervalMinutes: Number(
                    (event.currentTarget as HTMLSelectElement).value,
                  ),
                })}
            >
              {#each intervalOptions as option (option.minutes)}
                <option value={option.minutes}>{option.label}</option>
              {/each}
            </Select>
          </label>
          {#if job.intervalMinutes === 10080}
            <label class="grid gap-1 text-xs font-semibold text-ink/70">
              執行日
              <Select
                value={job.preferredWeekday}
                disabled={demoMode || $updateJob.isPending}
                onchange={(event: Event) =>
                  $updateJob.mutate({
                    preferredWeekday: Number(
                      (event.currentTarget as HTMLSelectElement).value,
                    ),
                  })}
              >
                {#each weekdayOptions as weekday, index (weekday)}
                  <option value={index}>{weekday}</option>
                {/each}
              </Select>
            </label>
          {/if}
          {#if job.intervalMinutes >= 1440}
            <label class="grid gap-1 text-xs font-semibold text-ink/70">
              開始時間
              <TimePicker
                value={job.preferredTime}
                onchange={(preferredTime) =>
                  !demoMode && $updateJob.mutate({ preferredTime })}
              />
            </label>
          {:else}
            <div
              class="flex items-end pb-2 text-xs leading-relaxed text-muted-foreground"
            >
              從上次同步完成後重新計時。
            </div>
          {/if}
        {/if}
      </div>
    {/if}
    {#if error || (job?.lastError && !sinopacCaptchaImage)}<p
        class="mt-2 text-xs text-coral"
      >
        {error ? `本次同步：${error}` : `上次同步：${job?.lastError}`}
      </p>{/if}
  </div>
  <section class="mt-4 overflow-hidden rounded-xl border border-border">
    <div
      class="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/45 px-4 py-3"
    >
      <div>
        <h3 class="text-sm font-semibold">連線憑證</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          已儲存的機密欄位不會顯示內容；留白會維持原值。
        </p>
      </div>
      {#if $save.isSuccess}<span
          class="rounded-full bg-moss/10 px-2.5 py-1 text-xs font-semibold text-moss"
          >已安全儲存</span
        >{/if}
    </div>
    <div class="grid gap-3 p-4">
      {#each fields as field (field.key)}
        {#if field.type === "checkbox"}
          <label class="flex items-center gap-2 text-sm"
            ><Checkbox
              checked={Boolean(values[field.key])}
              onchange={(e: Event) =>
                (values[field.key] = (
                  e.currentTarget as HTMLInputElement
                ).checked)}
            />{field.label}</label
          >
        {:else}
          {@const storedCredential = Boolean(
            $settings.data?.configured &&
            (field.type === "text" || field.type === "password"),
          )}
          {@const hasReplacement = Boolean(String(values[field.key] ?? ""))}
          <label class="grid gap-1.5 text-sm font-medium">
            <span class="flex flex-wrap items-center gap-2">
              <span>{field.label}</span>
              {#if storedCredential}
                <span
                  class={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${hasReplacement ? "bg-steel/10 text-steel" : "bg-moss/10 text-moss"}`}
                >
                  {hasReplacement ? "將更新" : "已儲存"}
                </span>
              {/if}
            </span>
            <Input
              class={storedCredential && !hasReplacement
                ? "bg-moss/[0.035] placeholder:text-ink/55"
                : ""}
              type={field.type}
              placeholder={storedCredential && !hasReplacement
                ? "••••••••　已安全儲存"
                : field.placeholder}
              value={String(values[field.key] ?? "")}
              oninput={(e: Event) =>
                (values[field.key] = (
                  e.currentTarget as HTMLInputElement
                ).value)}
            />
          </label>
        {/if}
      {/each}
    </div>
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-paper/70 px-4 py-3"
    >
      <p class="text-xs text-muted-foreground">
        儲存完成後，再使用上方的同步按鈕測試連線。
      </p>
      <Button
        size="sm"
        disabled={$save.isPending}
        onclick={() => {
          error = "";
          $save.reset();
          $save.mutate(buildConfig());
        }}
        ><Save class="size-4" />{$save.isPending
          ? "儲存中…"
          : "儲存憑證"}</Button
      >
    </div>
  </section>
  {#if $save.isError}<p class="mt-2 text-xs font-medium text-coral">
      儲存失敗：{error}
    </p>{/if}
  {#if otpRequired}<div
      class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
    >
      <p class="text-sm font-medium text-ink/80">
        TDCC 需要驗證碼，請查看{otpChannel === "sms"
          ? "手機簡訊"
          : "電子信箱"}。
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <Input
          class="min-w-40 flex-1"
          placeholder="輸入驗證碼"
          bind:value={otp}
        /><Button
          size="sm"
          disabled={$verifyOtp.isPending}
          onclick={() => $verifyOtp.mutate()}
          ><RefreshCw class="size-4" />驗證並同步</Button
        >
      </div>
    </div>{/if}
  <p class="mt-3 text-xs text-ink/50">
    {connectorId === "sinopac"
      ? "永豐首次驗證成功後，正式同步會直接呼叫 App JSON API；只有銀行要求重新登入時才需再輸入驗證碼。"
      : "輸入完帳號密碼後，請先按「儲存設定」，再按「同步」。"}
  </p>
</Card>
