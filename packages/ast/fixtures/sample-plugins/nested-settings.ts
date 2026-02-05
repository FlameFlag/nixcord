// @ts-expect-error - Test fixture, imports don't need to resolve
import definePlugin from '@utils/types';
// @ts-expect-error - Test fixture, imports don't need to resolve
import { definePluginSettings } from '@api/Settings';
// @ts-expect-error - Test fixture, imports don't need to resolve
import { OptionType } from '@utils/types';

export default definePlugin({
  name: 'NestedPlugin',
  description: 'A plugin with nested settings',
  settings: definePluginSettings({
    enable: {
      type: OptionType.BOOLEAN,
      description: 'Enable the plugin',
      default: false,
    },
    config: {
      nested: {
        type: OptionType.STRING,
        description: 'Nested setting',
        default: 'nested-value',
      },
      deep: {
        deeper: {
          type: OptionType.NUMBER,
          description: 'Deeply nested setting',
          default: 42,
        },
      },
    },
  }),
});
