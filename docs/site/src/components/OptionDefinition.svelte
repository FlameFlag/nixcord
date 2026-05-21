<script lang="ts">
import { stringifyDocValue } from '../options';
import type { OptionEntry } from '../types';

let { label = option.name, option }: { label?: string; option: OptionEntry } = $props();

const optionId = $derived(`opt-${option.name}`);
</script>

<div class="option-definition">
  <dt id={optionId} class="option-heading">
    <a class="term" href={`#${optionId}`} aria-label={option.name}>
      <code class="option">{label}</code>
    </a>
  </dt>
  <dd class="option-body">
    <p class="option-description">{stringifyDocValue(option.description)}</p>

    <dl class="option-fields">
      {#if option.type}
        <div class="option-field">
          <dt>Type</dt>
          <dd>{option.type}</dd>
        </div>
      {/if}

      {#if option.default != null}
        <div class="option-field">
          <dt>Default</dt>
          <dd><code class="literal">{stringifyDocValue(option.default)}</code></dd>
        </div>
      {/if}

      {#if option.example != null}
        <div class="option-field">
          <dt>Example</dt>
          <dd><code class="literal">{stringifyDocValue(option.example)}</code></dd>
        </div>
      {/if}

      {#if option.declarations?.length}
        <div class="option-field option-field-source">
          <dt>Declared by</dt>
          <dd>
            <ul class="source-list">
              {#each option.declarations as declaration, index (`${option.name}-${index}`)}
                <li>
                  <code class="filename">
                    <a class="filename" href={declaration.url}>{declaration.name}</a>
                  </code>
                </li>
              {/each}
            </ul>
          </dd>
        </div>
      {/if}
    </dl>
  </dd>
</div>
