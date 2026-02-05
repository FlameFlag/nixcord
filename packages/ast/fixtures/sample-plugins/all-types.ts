// @ts-expect-error - Test fixture, imports don't need to resolve
import definePlugin from '@utils/types';
// @ts-expect-error - Test fixture, imports don't need to resolve
import { definePluginSettings } from '@api/Settings';
// @ts-expect-error - Test fixture, imports don't need to resolve
import { OptionType } from '@utils/types';

export default definePlugin({
  name: 'AllTypesPlugin',
  description: 'A plugin with all setting types',
  settings: definePluginSettings({
    enable: {
      type: OptionType.BOOLEAN,
      description: 'Enable the plugin',
      default: true,
    },
    stringSetting: {
      type: OptionType.STRING,
      description: 'String setting',
      default: 'test',
    },
    intSetting: {
      type: OptionType.NUMBER,
      description: 'Integer setting',
      default: 42,
    },
    floatSetting: {
      type: OptionType.NUMBER,
      description: 'Float setting',
      default: 3.14,
    },
    enumSetting: {
      type: OptionType.SELECT,
      description: 'Enum setting',
      options: [
        { value: 'option1' },
        { value: 'option2' },
        { value: 123 },
        { value: true },
        { value: false },
      ],
    },
    sliderSetting: {
      type: OptionType.SLIDER,
      description: 'Slider setting',
      default: 0.5,
      markers: [0, 0.25, 0.5, 0.75, 1],
    },
    hiddenSetting: {
      type: OptionType.STRING,
      description: 'Hidden setting',
      default: 'hidden',
      hidden: true,
    },
    restartSetting: {
      type: OptionType.STRING,
      description: 'Requires restart',
      default: 'value',
      restartNeeded: true,
    },
  }),
});
