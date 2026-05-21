export type OptionDeclaration = {
  name?: string;
  url?: string;
};

export type RawOption = {
  declarations?: OptionDeclaration[];
  default?: unknown;
  description?: unknown;
  example?: unknown;
  loc?: string[];
  readOnly?: boolean;
  type?: string;
};

export type OptionEntry = RawOption & {
  category: OptionCategory;
  name: string;
  searchText: string;
};

export type OptionCategory = 'core' | 'shared' | 'vencord' | 'equicord';

export type PluginOptionGroup = {
  category: OptionCategory;
  name: string;
  optionCount: number;
  options: OptionEntry[];
  searchText: string;
};

export type OptionSectionItem =
  | {
      kind: 'option';
      option: OptionEntry;
    }
  | {
      group: PluginOptionGroup;
      kind: 'plugin';
    };

export type OptionSection = {
  description: string;
  id: string;
  items: OptionSectionItem[];
  optionCount: number;
  title: string;
};
