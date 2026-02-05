import definePlugin from '@utils/types';
import { definePluginSettings } from '@api/Settings';
import { OptionType } from '@utils/types';

const settings = definePluginSettings({
  theme: {
    type: OptionType.STRING,
    description: 'Equicord theme',
    default: 'night',
  },
});

export default definePlugin({
  name: 'Equicord Only',
  description: 'Only ships in Equicord',
  settings,
});
