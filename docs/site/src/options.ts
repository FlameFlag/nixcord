import type { OptionCategory, OptionEntry, OptionSection, RawOption } from './types';

const emptyText = 'Not specified';

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
  const sections: Omit<OptionSection, 'options'>[] = [
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

  return sections.map((section) => ({
    ...section,
    options: options.filter((option) => option.category === categoryFromSectionId(section.id)),
  }));
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
