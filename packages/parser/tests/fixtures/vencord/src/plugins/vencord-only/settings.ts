import { definePluginSettings } from '@api/Settings';
import { OptionType } from '@utils/types';

export default definePluginSettings({
  enabled: {
    type: OptionType.BOOLEAN,
    description: 'Enable feature',
    default: true,
  },
});
