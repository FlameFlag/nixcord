export const DEFINE_PLUGIN_FUNCTION_NAME = 'definePlugin';
export const DEFINE_PLUGIN_SETTINGS_FUNCTION_NAME = 'definePluginSettings';
export const GET_FUNCTION_NAME = 'get';
export const NAME_PROPERTY = 'name';
export const DESCRIPTION_PROPERTY = 'description';
export const IS_MODIFIED_PROPERTY = 'isModified';
export const DEFAULT_PROPERTY = 'default';
export const TYPE_PROPERTY = 'type';
export const OPTIONS_PROPERTY = 'options';
export const VALUE_PROPERTY = 'value';
export const LABEL_PROPERTY = 'label';
export const HIDDEN_PROPERTY = 'hidden';
export const PLACEHOLDER_PROPERTY = 'placeholder';
export const RESTART_NEEDED_PROPERTY = 'restartNeeded';
export const COMPONENT_PROPERTY = 'component';

export const PARSE_INT_RADIX = 10;

// Strings we match against when the TypeScript checker tells us what a property is annotated with
export const TS_TYPE_STRING = 'string';
export const TS_TYPE_NUMBER = 'number';
export const TS_TYPE_BOOLEAN = 'boolean';
export const TS_TYPE_UNDEFINED = 'undefined';

// Cheap heuristics for spotting array annotations without walking the full AST
export const TS_ARRAY_BRACKET_PATTERN = '[]';
export const TS_ARRAY_GENERIC_PATTERN = 'Array<';

// Canonical Nix type strings emitted in the generated module
export const NIX_ENUM_TYPE = 'types.enum';
export const NIX_TYPE_BOOL = 'types.bool';
export const NIX_TYPE_STR = 'types.str';
export const NIX_TYPE_INT = 'types.int';
export const NIX_TYPE_FLOAT = 'types.float';
export const NIX_TYPE_ATTRS = 'types.attrs';
export const NIX_TYPE_NULL_OR_STR = 'types.nullOr types.str';
export const NIX_TYPE_LIST_OF_STR = 'types.listOf types.str';
export const NIX_TYPE_LIST_OF_ATTRS = 'types.listOf types.attrs';

// OptionType names as they appear in plugin sources
export const OPTION_TYPE_BOOLEAN = 'BOOLEAN';
export const OPTION_TYPE_STRING = 'STRING';
export const OPTION_TYPE_NUMBER = 'NUMBER';
export const OPTION_TYPE_BIGINT = 'BIGINT';
export const OPTION_TYPE_SELECT = 'SELECT';
export const OPTION_TYPE_SLIDER = 'SLIDER';
export const OPTION_TYPE_COMPONENT = 'COMPONENT';
export const OPTION_TYPE_CUSTOM = 'CUSTOM';

// Method names frequently used in option-building patterns
export const METHOD_NAME_KEYS = 'keys';
export const METHOD_NAME_VALUES = 'values';
export const METHOD_NAME_FROM = 'from';
export const METHOD_NAME_MAP = 'map';
export const GLOBAL_ARRAY_NAME = 'Array';

// Magic numbers used while inferring enum/array behavior
export const BOOLEAN_ENUM_LENGTH = 2;
export const ARRAY_FIRST_INDEX = 0;

// Regex helpers for identifier/type parsing
export const RESTART_REQUIRED_SUFFIX = '(restart required)';
export const STRING_ARRAY_TYPE_PATTERN = /string\[\]|\bArray<string>\b/;
export const INTEGER_STRING_PATTERN = /^[0-9]+$/;

export type EnumLiteral = string | number | boolean;
