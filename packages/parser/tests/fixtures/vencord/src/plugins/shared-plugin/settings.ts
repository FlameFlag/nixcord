import { definePluginSettings } from '@api/Settings';
import { OptionType } from '@utils/types';

export default definePluginSettings({
  mode: {
    type: OptionType.SELECT,
    description: 'Choose behavior',
    options: [
      { label: 'Default', value: 'default', default: true },
      { label: 'Alt', value: 'alt' },
    ],
  },
  message: {
    type: OptionType.STRING,
    description: 'Message text',
    default: 'vencord',
  },
});
