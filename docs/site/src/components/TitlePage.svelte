<script lang="ts">
let {
  id,
  title,
  subtitle,
  level = 1,
  rule = false,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  level?: 1 | 2 | 3;
  rule?: boolean;
} = $props();
</script>

<header class="titlepage">
  <hgroup>
    {#if level === 1}
      <h1 {id} class="title">{title}</h1>
    {:else if level === 2}
      <h2 {id} class="title">{title}</h2>
    {:else}
      <h3 {id} class="title">{title}</h3>
    {/if}
    {#if subtitle}
      <p class="subtitle">{subtitle}</p>
    {/if}
  </hgroup>
  {#if rule}
    <hr />
  {/if}
</header>
