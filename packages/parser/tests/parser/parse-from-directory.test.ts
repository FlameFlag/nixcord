import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fse from 'fs-extra';
import { describe, expect, test } from 'vitest';
import { parsePlugins } from '../../src/index.js';
import { createPlugin, createPluginFile, createTsConfig } from '../helpers/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('parsePluginsFromDirectory()', () => {
  test('parses multiple plugins', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      await fse.ensureDir(pluginsDir);

      // Create multiple plugins
      for (let i = 1; i <= 3; i++) {
        const pluginDir = join(pluginsDir, `plugin-${i}`);
        await fse.ensureDir(pluginDir);
        await createPluginFile(
          pluginDir,
          'index.ts',
          `export function definePlugin(definition: { name: string; description: string }) {
            return definition;
          }

          export const plugin = definePlugin({
            name: "Plugin ${i}",
            description: "Plugin ${i} description",
          });`
        );
      }

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(Object.keys(result.vencordPlugins).length).toBe(3);
      expect(result.vencordPlugins['Plugin 1']).toBeDefined();
      expect(result.vencordPlugins['Plugin 2']).toBeDefined();
      expect(result.vencordPlugins['Plugin 3']).toBeDefined();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles empty directory', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      await fse.ensureDir(pluginsDir);
      // Don't create any plugins

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(Object.keys(result.vencordPlugins).length).toBe(0);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('filters out failed plugins', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-'));
    try {
      const pluginsDir = join(tempDir, 'src', 'plugins');
      await fse.ensureDir(pluginsDir);

      // Valid plugin
      await createPlugin(tempDir, 'valid-plugin', {
        indexContent: `export function definePlugin(definition: { name: string; description: string }) {
          return definition;
        }

        export const plugin = definePlugin({
          name: "Valid Plugin",
          description: "Valid",
        });`,
      });

      // Invalid plugin (no source file)
      const invalidPluginDir = join(pluginsDir, 'invalid-plugin');
      await fse.ensureDir(invalidPluginDir);
      // Don't create index.ts

      await createTsConfig(tempDir);

      const result = await parsePlugins(tempDir);
      expect(Object.keys(result.vencordPlugins).length).toBe(1);
      expect(result.vencordPlugins['Valid Plugin']).toBeDefined();
      expect(result.vencordPlugins['invalid-plugin']).toBeUndefined();
    } finally {
      await fse.remove(tempDir);
    }
  });
});
