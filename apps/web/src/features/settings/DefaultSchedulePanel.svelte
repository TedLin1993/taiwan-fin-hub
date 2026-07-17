<script lang="ts">
  import { onMount } from "svelte";
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { Clock3, Save } from "@lucide/svelte";
  import Card from "../../components/ui/Card.svelte";
  import Button from "../../components/ui/Button.svelte";
  import Select from "../../components/ui/Select.svelte";
  import TimePicker from "../../components/ui/TimePicker.svelte";
  import type { ApiClient } from "../../lib/api";
  import { queryKeys } from "../../lib/api";
  import { syncScheduleQuery } from "../../lib/queries";
  import type { SyncJobRow, SyncScheduleSettings } from "../../lib/types";

  let {
    api,
    demoMode,
    jobs,
  }: {
    api: ApiClient;
    demoMode: boolean;
    jobs: SyncJobRow[];
  } = $props();

  const queryClient = useQueryClient();
  const schedule = createQuery(syncScheduleQuery(() => api));
  const intervalOptions = [
    { label: "每小時", minutes: 60 },
    { label: "每 6 小時", minutes: 360 },
    { label: "每 12 小時", minutes: 720 },
    { label: "每天", minutes: 1440 },
    { label: "每週", minutes: 10080 },
  ];
  let intervalMinutes = $state(1440);
  let preferredTime = $state("06:00");
  const inheritedJobs = $derived(
    jobs.filter((job) => job.scheduleMode === "inherit").length,
  );

  onMount(() =>
    schedule.subscribe((result) => {
      if (!result.data) return;
      intervalMinutes = result.data.intervalMinutes;
      preferredTime = result.data.preferredTime;
    }),
  );

  const save = createMutation({
    mutationFn: () =>
      api.put<SyncScheduleSettings>("/api/sync-schedule", {
        intervalMinutes,
        preferredTime,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.syncSchedule });
      queryClient.invalidateQueries({ queryKey: queryKeys.syncJobs });
    },
  });
</script>

<Card as="section" class="overflow-hidden">
  <div
    class="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-ink px-5 py-4 text-white"
  >
    <div class="flex items-start gap-3">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white"
      >
        <Clock3 class="size-5" />
      </span>
      <div>
        <h2 class="font-semibold">預設同步排程</h2>
        <p class="mt-1 text-xs text-white/55">
          選擇跟隨預設的連接器，會從設定時間起依序同步。
        </p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="rounded-full bg-white/10 px-3 py-1.5 text-white/70">
        Asia/Taipei
      </span>
      <span class="rounded-full bg-white/10 px-3 py-1.5 font-semibold">
        {inheritedJobs} 個連接器跟隨
      </span>
    </div>
  </div>
  <div
    class="grid gap-4 p-5 md:grid-cols-[minmax(180px,0.8fr)_minmax(180px,0.8fr)_1fr_auto] md:items-end"
  >
    <label class="grid gap-1.5 text-sm font-medium">
      同步頻率
      <Select bind:value={intervalMinutes} disabled={demoMode}>
        {#each intervalOptions as option (option.minutes)}
          <option value={option.minutes}>{option.label}</option>
        {/each}
      </Select>
    </label>
    {#if intervalMinutes >= 1440}
      <label class="grid gap-1.5 text-sm font-medium">
        開始時間
        <TimePicker bind:value={preferredTime} disabled={demoMode} />
      </label>
    {:else}
      <div class="grid gap-1.5 text-sm font-medium">
        計時方式
        <div
          class="flex h-10 items-center rounded-md border border-border bg-muted/50 px-3 text-sm text-muted-foreground"
        >
          從上次同步完成後計算
        </div>
      </div>
    {/if}
    <p class="text-xs leading-relaxed text-muted-foreground md:pb-2">
      修改後只會影響「跟隨預設」的來源；自訂排程不會改變。
    </p>
    <Button
      disabled={demoMode || $save.isPending}
      onclick={() => $save.mutate()}
    >
      <Save class="size-4" />{$save.isPending ? "儲存中…" : "儲存預設"}
    </Button>
  </div>
  {#if $save.isSuccess}
    <p
      class="border-t border-border bg-moss/5 px-5 py-2 text-xs font-medium text-moss"
    >
      預設同步排程已更新，跟隨此設定的連接器也已重新排程。
    </p>
  {:else if $save.isError}
    <p
      class="border-t border-border bg-coral/5 px-5 py-2 text-xs font-medium text-coral"
    >
      預設排程儲存失敗，請稍後再試。
    </p>
  {/if}
</Card>
