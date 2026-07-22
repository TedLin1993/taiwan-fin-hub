<script lang="ts">
  let { title, body }: { title: string; body: string } = $props();
</script>

<section
  class="rounded-xl border border-dashed border-ink/20 bg-white p-8 text-center shadow-xs"
>
  <h2 class="text-lg font-semibold">{title}</h2>
  <p class="mt-2 text-sm text-ink/65">{body}</p>
</section>
