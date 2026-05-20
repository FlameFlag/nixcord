<script lang="ts">
import {
  configurationExample,
  darwinExample,
  flakeExample,
  homeManagerExample,
  introductionToc,
  legcordExample,
  nixosExample,
  userPluginsExample,
} from '../content';
import CodeBlock from './CodeBlock.svelte';
import TableOfContents from './TableOfContents.svelte';
import TitlePage from './TitlePage.svelte';
</script>

<section class="section" aria-labelledby="sec-introduction">
  <TitlePage id="sec-introduction" title="Introduction" level={2} />
  <TableOfContents items={introductionToc} />

  <p>Nixcord lets you manage <a class="link" href="https://github.com/Vendicated/Vencord">Vencord</a>, <a class="link" href="https://github.com/Equicord/Equicord">Equicord</a>, and clients like <a class="link" href="https://github.com/Vencord/Vesktop">Vesktop</a>, <a class="link" href="https://github.com/SpikeHD/Dorion">Dorion</a>, and <a class="link" href="https://github.com/Legcord/Legcord">Legcord</a> declaratively</p>
  <p>Instead of configuring your plugins via the UI (and losing them when you reinstall), you define everything in Nix. It handles patching the client, injecting the config, and keeping your setup reproducible</p>

  <blockquote class="blockquote">
    <p><strong>Heads up:</strong> Since this is declarative, the in-app "Plugins" menu won't save changes permanently. You have to update your <code class="literal">.nix</code> file to make settings stick</p>
  </blockquote>

  <p>It supports:</p>
  <ul class="itemizedlist compact">
    <li class="listitem"><p><strong>Standard Discord</strong> (Stable, PTB, Canary, Dev), with Vencord or Equicord</p></li>
    <li class="listitem"><p><strong>Vesktop</strong> &amp; <strong>Equibop</strong></p></li>
    <li class="listitem"><p><strong>Dorion</strong></p></li>
    <li class="listitem"><p><strong>Legcord</strong></p></li>
  </ul>

  <section class="section" aria-labelledby="getting-started">
    <TitlePage id="getting-started" title="Getting Started" level={3} />
    <p>Add Nixcord to your <code class="literal">flake.nix</code> inputs:</p>
    <CodeBlock code={flakeExample} />
    <p>Then import the module:</p>
    <p><strong>Home Manager (Recommended)</strong></p>
    <CodeBlock code={homeManagerExample} />
    <p><strong>NixOS (System-wide)</strong></p>
    <CodeBlock code={nixosExample} />
    <p><strong>nix-darwin (macOS)</strong></p>
    <CodeBlock code={darwinExample} />
  </section>

  <section class="section" aria-labelledby="sec-configuration">
    <TitlePage id="sec-configuration" title="Configuration" level={3} />
    <p>Enable your client and configure plugins:</p>
    <p><strong>Tip:</strong> Launch your client once manually to look through the plugins list so you know what you actually want to enable</p>
    <CodeBlock code={configurationExample} />
  </section>

  <section class="section" aria-labelledby="sec-legcord">
    <TitlePage id="sec-legcord" title="Legcord" level={3} />
    <p><a class="link" href="https://github.com/Legcord/Legcord">Legcord</a> is a lightweight Discord client. Enable it with:</p>
    <CodeBlock code={legcordExample} />
  </section>

  <section class="section" aria-labelledby="sec-user-plugins">
    <TitlePage id="sec-user-plugins" title="Third-Party User Plugins" level={3} />
    <p>You can load custom Vencord/Equicord plugins that aren't in the upstream plugin list using <code class="literal">userPlugins</code>. Any plugin you add also needs to be enabled in <code class="literal">extraConfig.plugins</code>:</p>
    <CodeBlock code={userPluginsExample} />
  </section>

  <section class="section" aria-labelledby="sec-dorion">
    <TitlePage id="sec-dorion" title="A Note on Dorion" level={3} />
    <p>Dorion needs <code class="literal">LocalStorage</code> databases that only exist after a successful launch. If you just enable it in Nix immediately, it won't work</p>
    <ol class="orderedlist compact">
      <li class="listitem"><p>Run it once temporarily: <code class="literal">nix run github:FlameFlag/nixcord#dorion</code></p></li>
      <li class="listitem"><p>Log in and close it</p></li>
      <li class="listitem"><p>Enable <code class="literal">dorion.enable = true</code> in your config and rebuild</p></li>
    </ol>
    <p><em>Dorion uses WebKitGTK, so voice/video might fail with "Unsupported Browser" errors. Can't fix that on our end</em></p>
  </section>
</section>
