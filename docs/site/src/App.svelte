<script lang="ts">
import { mainToc, revision } from './content';
import IntroductionSection from './components/IntroductionSection.svelte';
import OptionsReference from './components/OptionsReference.svelte';
import PrefaceSection from './components/PrefaceSection.svelte';
import TableOfContents from './components/TableOfContents.svelte';
import TitlePage from './components/TitlePage.svelte';
</script>

<svelte:head>
  <title>Nixcord manual</title>
  <meta name="description" content="Nixcord manual" />
</svelte:head>

<main class="book">
  <TitlePage id="nixcord-manual" title="Nixcord manual" subtitle={`Version ${revision}`} rule />
  <TableOfContents title="Table of Contents" items={mainToc} />
  <PrefaceSection />
  <IntroductionSection />
  <OptionsReference />
</main>
