// @ts-expect-error - Test fixture, imports don't need to resolve
import definePlugin from '@utils/types';
// @ts-expect-error - Test fixture, imports don't need to resolve
import { definePluginSettings } from '@api/Settings';
// @ts-expect-error - Test fixture, imports don't need to resolve
import { OptionType } from '@utils/types';

export default definePlugin({
  name: 'SimplePlugin',
  description: 'A simple test plugin',
  settings: definePluginSettings({
    enabled: {
      type: OptionType.BOOLEAN,
      description: 'Enable the plugin',
      default: true,
    },
    message: {
      type: OptionType.STRING,
      description: 'Message to display',
      default: 'Hello World',
    },
  }),
});
