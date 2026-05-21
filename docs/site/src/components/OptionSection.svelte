<script lang="ts">
import type { OptionSection } from '../types';
import OptionDefinition from './OptionDefinition.svelte';
import PluginOptionGroup from './PluginOptionGroup.svelte';

let { section, open = false }: { section: OptionSection; open?: boolean } = $props();
</script>

<details id={section.id} class="option-section" {open}>
  <summary class="option-section-summary">
    <h3 class="option-section-heading">{section.title}</h3>
    <span class="option-section-count">{section.optionCount} options</span>
  </summary>

  <p class="option-section-description">{section.description}</p>

  <dl class="variablelist">
    {#each section.items as item (item.kind === 'plugin' ? item.group.name : item.option.name)}
      {#if item.kind === 'plugin'}
        <PluginOptionGroup group={item.group} />
      {:else}
        <OptionDefinition option={item.option} />
      {/if}
    {/each}
  </dl>
</details>
