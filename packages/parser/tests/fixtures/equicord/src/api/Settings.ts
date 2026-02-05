export type PluginSettings = Record<string, unknown>;

export function definePluginSettings<T extends PluginSettings>(settings: T) {
  return {
    ...settings,
    withPrivateSettings<_U>() {
      return this;
    },
  };
}
