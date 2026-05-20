<script lang="ts">
import { onMount, tick } from 'svelte';
import { groupOptions, loadOptions } from '../options';
import type { OptionEntry, OptionSection as OptionSectionData } from '../types';
import OptionSection from './OptionSection.svelte';
import TitlePage from './TitlePage.svelte';

let options = $state.raw<OptionEntry[]>([]);
let sections = $state.raw<OptionSectionData[]>([]);
let optionsLoading = $state(true);
let optionsError = $state('');

loadOptions()
  .then(async (loadedOptions) => {
    options = loadedOptions;
    sections = groupOptions(loadedOptions);
    optionsLoading = false;
    await tick();
    revealCurrentHash();
  })
  .catch((error: unknown) => {
    optionsError = error instanceof Error ? error.message : 'Could not load options.json';
    optionsLoading = false;
  });

onMount(() => {
  window.addEventListener('hashchange', revealCurrentHash);

  return () => {
    window.removeEventListener('hashchange', revealCurrentHash);
  };
});

function revealCurrentHash() {
  if (!window.location.hash.startsWith('#opt-')) return;

  const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  const details = target?.closest('details.option-section');

  if (details instanceof HTMLDetailsElement) {
    details.open = true;
    target?.closest('.option-definition')?.scrollIntoView({ block: 'start' });
  }
}
</script>

<section class="section" aria-labelledby="sec-options">
  <TitlePage id="sec-options" title="Configuration Options" level={2} />
  <p>Here is the complete reference for every available option in Nixcord. This list is auto-generated directly from the source modules</p>

  <section id="appendix-configuration-options" class="variablelist" aria-label="Configuration options reference">
    {#if optionsError}
      <p class="options-error">Unable to load options.json: {optionsError}</p>
    {:else if optionsLoading}
      <p>Loading options...</p>
    {:else}
      <section class="option-sections" aria-label={`${options.length} configuration options grouped by source`}>
        {#each sections as section (section.id)}
          <OptionSection {section} />
        {/each}
      </section>
    {/if}
  </section>
</section>
