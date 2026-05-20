<script lang="ts">
type TocItem = {
  href: string;
  label: string;
};

let {
  items,
  title,
}: {
  items: TocItem[];
  title?: string;
} = $props();

const isMainToc = $derived(title != null);
const tocTitle = $derived(title ?? 'In This Section');
</script>

<nav class="toc" class:toc-main={isMainToc} class:toc-local={!isMainToc} aria-label={tocTitle}>
  <p class="toc-title">{tocTitle}</p>
  <ul class="toc-list">
    {#each items as item (item.href)}
      <li><a href={item.href}>{item.label}</a></li>
    {/each}
  </ul>
</nav>
