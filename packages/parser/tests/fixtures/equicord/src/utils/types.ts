export enum OptionType {
  STRING,
  NUMBER,
  BIGINT,
  BOOLEAN,
  SELECT,
  SLIDER,
  COMPONENT,
  CUSTOM,
}

export interface PluginDefinition {
  name: string;
  description: string;
  settings?: Record<string, unknown>;
}

export default function definePlugin<P extends PluginDefinition>(plugin: P): P {
  return plugin;
}

export function defineDefault<T>(value: T): T {
  return value;
}
