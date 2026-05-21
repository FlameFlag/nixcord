import type {
  OptionCategory,
  OptionEntry,
  OptionSection,
  OptionSectionItem,
  PluginOptionGroup,
  RawOption,
} from './types';

const emptyText = 'Not specified';
const pluginOptionPrefix = 'programs.nixcord.config.plugins.';

export function stringifyDocValue(value: unknown): string {
  if (value == null) return emptyText;
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object') {
    const maybeLiteral = value as { text?: unknown };
    if (typeof maybeLiteral.text === 'string') {
      return normalizeWhitespace(maybeLiteral.text);
    }
  }

  return normalizeWhitespace(JSON.stringify(value, null, 2));
}

function prepareOptions(raw: Record<string, RawOption>): OptionEntry[] {
  return Object.entries(raw)
    .map(([name, option]) => {
      const description = stringifyDocValue(option.description);
      const type = option.type ?? '';

      return {
        ...option,
        category: getOptionCategory(option),
        name,
        searchText: `${name} ${type} ${description}`.toLowerCase(),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function groupOptions(options: OptionEntry[]): OptionSection[] {
  const sections: Pick<OptionSection, 'description' | 'id' | 'title'>[] = [
    {
      description: 'Module, client, package, theme, and extra configuration options.',
      id: 'options-core',
      title: 'Core Nixcord Options',
    },
    {
      description: 'Plugin options available for both Vencord and Equicord clients.',
      id: 'options-shared',
      title: 'Shared Plugin Options',
    },
    {
      description: 'Plugin options that only exist in Vencord.',
      id: 'options-vencord',
      title: 'Vencord-only Plugin Options',
    },
    {
      description: 'Plugin options that only exist in Equicord.',
      id: 'options-equicord',
      title: 'Equicord-only Plugin Options',
    },
  ];

  return sections.map((section) => {
    const category = categoryFromSectionId(section.id);
    const sectionOptions = options.filter((option) => option.category === category);

    return {
      ...section,
      items: groupSectionOptions(sectionOptions),
      optionCount: sectionOptions.length,
    };
  });
}

export async function loadOptions(): Promise<OptionEntry[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}options.json`);

  if (!response.ok) {
    throw new Error(`Could not load options.json (${response.status})`);
  }

  const raw = (await response.json()) as Record<string, RawOption>;
  return prepareOptions(raw);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getOptionCategory(option: RawOption): OptionCategory {
  const declarationText = option.declarations
    ?.map((declaration) => `${declaration.name ?? ''} ${declaration.url ?? ''}`)
    .join(' ');

  if (declarationText?.includes('modules/plugins/shared.json')) return 'shared';
  if (declarationText?.includes('modules/plugins/vencord.json')) return 'vencord';
  if (declarationText?.includes('modules/plugins/equicord.json')) return 'equicord';

  return 'core';
}

function groupSectionOptions(options: OptionEntry[]): OptionSectionItem[] {
  const pluginGroups = new Map<string, OptionEntry[]>();
  const coreOptions: OptionSectionItem[] = [];

  for (const option of options) {
    const pluginRoot = getPluginRoot(option.name);

    if (pluginRoot == null) {
      coreOptions.push({ kind: 'option', option });
      continue;
    }

    const groupOptions = pluginGroups.get(pluginRoot) ?? [];
    groupOptions.push(option);
    pluginGroups.set(pluginRoot, groupOptions);
  }

  const groupedPlugins: OptionSectionItem[] = Array.from(pluginGroups, ([name, groupOptions]) => {
    const sortedOptions = [...groupOptions].sort((left, right) => comparePluginOptions(name, left, right));

    return {
      group: {
        category: sortedOptions[0]?.category ?? 'core',
        name,
        optionCount: sortedOptions.length,
        options: sortedOptions,
        searchText: sortedOptions.map((option) => option.searchText).join(' '),
      } satisfies PluginOptionGroup,
      kind: 'plugin',
    };
  });

  return [...coreOptions, ...groupedPlugins].sort((left, right) => getSectionItemName(left).localeCompare(getSectionItemName(right)));
}

export function getPluginOptionLabel(pluginName: string, optionName: string): string {
  return optionName.startsWith(`${pluginName}.`) ? optionName.slice(pluginName.length + 1) : optionName;
}

function getPluginRoot(optionName: string): string | null {
  if (!optionName.startsWith(pluginOptionPrefix)) return null;

  const parts = optionName.split('.');
  if (parts.length < 6) return null;

  return parts.slice(0, 5).join('.');
}

function getSectionItemName(item: OptionSectionItem): string {
  return item.kind === 'plugin' ? item.group.name : item.option.name;
}

function comparePluginOptions(pluginName: string, left: OptionEntry, right: OptionEntry): number {
  const leftLabel = getPluginOptionLabel(pluginName, left.name);
  const rightLabel = getPluginOptionLabel(pluginName, right.name);
  const leftRank = getPluginOptionRank(leftLabel);
  const rightRank = getPluginOptionRank(rightLabel);

  if (leftRank !== rightRank) return leftRank - rightRank;
  return leftLabel.localeCompare(rightLabel);
}

function getPluginOptionRank(label: string): number {
  return label === 'enable' || label === 'enabled' ? 0 : 1;
}

function categoryFromSectionId(sectionId: string): OptionCategory {
  switch (sectionId) {
    case 'options-shared':
      return 'shared';
    case 'options-vencord':
      return 'vencord';
    case 'options-equicord':
      return 'equicord';
    default:
      return 'core';
  }
}
