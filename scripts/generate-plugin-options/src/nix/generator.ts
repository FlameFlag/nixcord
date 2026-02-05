import { entries, filter, isEmpty, keys, map, pipe, reduce } from 'remeda';
import { match, P } from 'ts-pattern';
import { Maybe } from 'true-myth';
import type { ReadonlyDeep } from 'type-fest';
import type { PluginConfig, PluginSetting } from '../shared/types.js';
import { type NixAttrSet, NixGenerator, type NixRaw, type NixValue } from './generator-base.js';
import { isBoolean, isNumber, isString, isNull, isArray, isObject } from '../shared/type-guards.js';
import { INTEGER_STRING_PATTERN, NIX_ENUM_TYPE, NIX_TYPE_FLOAT, NIX_TYPE_INT } from '../core/ast/extractor/constants.js';

const gen = new NixGenerator();

const ENABLE_SETTING_NAME = 'enable';
const NIX_ENABLE_OPTION_FUNCTION = 'mkEnableOption';
const NIX_OPTION_FUNCTION = 'mkOption';
const OPTION_CONFIG_INDENT_LEVEL = 2;
const MODULE_INDENT_LEVEL = 0;
const NIX_MODULE_HEADER = '{ lib, ... }:';
const NIX_MODULE_INHERIT = '  inherit (lib) types mkEnableOption mkOption;';

export type PluginCategory = 'shared' | 'vencord' | 'equicord';

const categoryLabel = (category: PluginCategory): string =>
  match(category)
    .with('shared', () => ' (Shared between Vencord and Equicord)')
    .with('vencord', () => ' (Vencord-only)')
    .with('equicord', () => ' (Equicord-only)')
    .exhaustive();

const buildEnumMappingDescription = (
  enumValues: readonly (string | number | boolean)[],
  enumLabels?: ReadonlyDeep<Record<string, string> & Partial<Record<number, string>>>
): Maybe<string> => {
  if (!enumLabels) return Maybe.nothing();

  const integerValues = filter(enumValues, isNumber);
  if (isEmpty(integerValues)) return Maybe.nothing();

  const mappings = pipe(
    integerValues,
    map(intValue => ({
      value: intValue,
      label: enumLabels[intValue] ?? enumLabels[String(intValue)]
    })),
    filter((item): item is { value: number; label: string } => typeof item.label === 'string'),
    map(item => `${item.value} = ${item.label}`)
  );

  return isEmpty(mappings) ? Maybe.nothing() : Maybe.just(mappings.join(', '));
};

const buildNixOptionConfig = (setting: Readonly<PluginSetting>): NixAttrSet => {
  const config: NixAttrSet = {};

  const typeConfig = setting.type?.includes('enum')
    ? gen.raw(`${NIX_ENUM_TYPE} [ ${pipe(setting.enumValues ?? [], map(v => isString(v) ? gen.string(v) : String(v))).join(' ')} ]`)
    : gen.raw(setting.type);

  config.type = typeConfig;

  if (setting.default !== undefined) {
    if (setting.default === null) {
      config.default = null;
    } else {
      const defaultResult = match([setting.type, setting.default] as const)
        .when(
          ([type, val]) => isNumber(val) && type === NIX_TYPE_FLOAT && Number.isInteger(val),
          ([, val]) => Maybe.just(gen.raw((val as number).toFixed(1)))
        )
        .when(
          ([type, val]) => type === NIX_TYPE_INT && isString(val) && INTEGER_STRING_PATTERN.test(val),
          ([, val]) => Maybe.just(gen.raw(val as string))
        )
        .when(
          ([, val]) => isString(val) || isNumber(val) || isBoolean(val) || isArray(val) || (isObject(val) && !isNull(val)),
          ([, val]) => Maybe.just(val as Exclude<NixValue, null>)
        )
        .otherwise(() => Maybe.nothing<Exclude<NixValue, null>>());

      if (defaultResult.isJust) config.default = defaultResult.value;
    }
  }

  if (setting.description) {
    const isIntegerEnum = setting.enumValues?.every(isNumber) && setting.type === NIX_ENUM_TYPE;
    const finalDesc = isIntegerEnum && setting.enumValues
      ? buildEnumMappingDescription(setting.enumValues, setting.enumLabels)
          .map(mapping => `${setting.description}\n\nValues: ${mapping}`)
          .unwrapOr(setting.description)
      : setting.description;
    config.description = gen.raw(gen.string(finalDesc, true));
  }

  if (setting.example && !setting.description?.includes(setting.example)) {
    config.example = setting.example;
  }

  return config;
};

export const generateNixSetting = (setting: Readonly<PluginSetting>, category?: PluginCategory): NixRaw => {
  if (setting.name === ENABLE_SETTING_NAME) {
    const desc = category ? (setting.description ?? '') + categoryLabel(category) : setting.description ?? '';
    return gen.raw(`${NIX_ENABLE_OPTION_FUNCTION} ${desc ? gen.string(desc, true) : '""'}`);
  }
  return gen.raw(`${NIX_OPTION_FUNCTION} ${gen.attrSet(buildNixOptionConfig(setting), OPTION_CONFIG_INDENT_LEVEL)}`);
};

export const generateNixPlugin = (
  _pluginName: string,
  config: Readonly<PluginConfig>,
  category?: PluginCategory
): NixAttrSet => {
  const baseAttrSet = pipe(
    entries(config.settings),
    reduce((acc, [, setting]) => {
      acc[gen.identifier(setting.name)] = 'settings' in setting
        ? generateNixPlugin(setting.name, setting as PluginConfig, category)
        : generateNixSetting(setting as PluginSetting, category);
      return acc;
    }, {} as NixAttrSet)
  );

  if (Object.hasOwn(config.settings, ENABLE_SETTING_NAME)) return baseAttrSet;

  const description = category ? (config.description ?? '') + categoryLabel(category) : config.description ?? '';
  return {
    enable: gen.raw(`${NIX_ENABLE_OPTION_FUNCTION} ${description ? gen.string(description, true) : '""'}`),
    ...baseAttrSet,
  };
};

export const generateNixModule = (
  plugins: ReadonlyDeep<Record<string, PluginConfig>>,
  category?: PluginCategory
): string => {
  const lines = [
    '# This file is auto-generated by scripts/generate-plugin-options',
    '# DO NOT EDIT this file directly; instead update the generator',
    '',
    NIX_MODULE_HEADER,
    'let',
    NIX_MODULE_INHERIT,
    'in',
  ];

  const pluginEntries = pipe(
    keys(plugins),
    map(pluginName => plugins[pluginName] ? [gen.identifier(pluginName), generateNixPlugin(pluginName, plugins[pluginName], category)] as const : undefined),
    filter((entry): entry is readonly [string, NixAttrSet] => entry !== undefined)
  );

  const moduleContent = gen.attrSet(
    pipe(
      pluginEntries,
      reduce((acc, [nixName, pluginAttr]) => {
        acc[nixName] = pluginAttr;
        return acc;
      }, {} as NixAttrSet)
    ),
    MODULE_INDENT_LEVEL
  );

  return [...lines, moduleContent].join('\n');
};
