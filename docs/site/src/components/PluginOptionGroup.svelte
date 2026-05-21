<script lang="ts">
import { getPluginOptionLabel } from '../options';
import type { PluginOptionGroup } from '../types';
import OptionDefinition from './OptionDefinition.svelte';

let { group }: { group: PluginOptionGroup } = $props();

const groupId = $derived(`opt-${group.name}`);
</script>

<details id={groupId} class="option-plugin">
  <summary class="option-plugin-summary">
    <a class="term" href={`#${groupId}`} aria-label={group.name}>
      <code class="option">{group.name}</code>
    </a>
    <span class="option-plugin-count">{group.optionCount} options</span>
  </summary>

  <dl class="variablelist option-plugin-options">
    {#each group.options as option (option.name)}
      <OptionDefinition {option} label={getPluginOptionLabel(group.name, option.name)} />
    {/each}
  </dl>
</details>
