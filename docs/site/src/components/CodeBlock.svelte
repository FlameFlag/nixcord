<script lang="ts">
import hljs from 'highlight.js/lib/core';
import nix from 'highlight.js/lib/languages/nix';

let { code, language = 'nix' }: { code: string; language?: string } = $props();

hljs.registerLanguage('nix', nix);

const highlighted = $derived(
  hljs.highlight(code.trimEnd(), { language, ignoreIllegals: true }).value
);
</script>

<pre><code class={`hljs programlisting language-${language}`}>{@html highlighted}</code></pre>
