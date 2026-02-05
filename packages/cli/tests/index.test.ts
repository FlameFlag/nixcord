import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fse from 'fs-extra';
import type { ParsedPluginsResult, PluginConfig } from '@nixcord/shared';
import { ParsedPluginsResultSchema } from '@nixcord/shared';
import { parsePlugins } from '@nixcord/parser';
import { generateNixModule } from '@nixcord/nix-generator';
import { validateParsedResults } from '../src/runner/index.js';

const cliMocks = vi.hoisted(() => ({
  runCli: vi.fn(() => Promise.resolve()),
  handleCliError: vi.fn(),
}));

vi.mock('../src/cli.js', () => cliMocks);
vi.mock('../src/runner/index.js', async (orig) => ({ ...(await orig()) }));

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value as string;
  }
}

describe('index entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    restoreEnv();
  });

  afterEach(() => {
    vi.resetModules();
    restoreEnv();
  });

  test('skips CLI execution when running under tests', async () => {
    process.env.NODE_ENV = 'test';
    await import('../src/index.js');
    expect(cliMocks.runCli).not.toHaveBeenCalled();
  });

  test('invokes CLI and forwards errors outside of test mode', async () => {
    delete process.env.NODE_ENV;
    delete process.env.VITEST;
    const failure = new Error('boom');
    cliMocks.runCli.mockRejectedValueOnce(failure);

    await import('../src/index.js');

    expect(cliMocks.runCli).toHaveBeenCalledTimes(1);
    expect(cliMocks.handleCliError).toHaveBeenCalledWith(failure);
  });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('validateParsedResults', () => {
  test('validateParsedResults validates correct structure', () => {
    const validResult: ParsedPluginsResult = {
      vencordPlugins: {
        TestPlugin: {
          name: 'TestPlugin',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    // Should not throw
    expect(() => {
      validateParsedResults(validResult);
    }).not.toThrow();
  });

  test('validateParsedResults rejects invalid structure', () => {
    const invalidResult = {
      vencordPlugins: 'not an object',
      equicordPlugins: {},
    } as unknown as ParsedPluginsResult;

    expect(() => {
      validateParsedResults(invalidResult);
    }).toThrow();
  });

  test('validateParsedResults validates both vencord and equicord results', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {
        Plugin1: {
          name: 'Plugin1',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    const equicordResult: ParsedPluginsResult = {
      vencordPlugins: {
        Plugin1: {
          name: 'Plugin1',
          settings: {},
        },
      },
      equicordPlugins: {
        EquicordPlugin: {
          name: 'EquicordPlugin',
          settings: {},
        },
      },
    };

    expect(() => {
      validateParsedResults(vencordResult, equicordResult);
    }).not.toThrow();
  });

  test('validateParsedResults handles missing equicord result', () => {
    const vencordResult: ParsedPluginsResult = {
      vencordPlugins: {
        Plugin1: {
          name: 'Plugin1',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    expect(() => {
      validateParsedResults(vencordResult);
    }).not.toThrow();
  });
});

describe('CLI File Operations', () => {
  test('generates correct output file structure', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const outputDir = join(tempDir, 'output');
    const pluginsDir = join(outputDir, 'plugins');

    try {
      await fse.ensureDir(pluginsDir);

      const plugins: Record<string, PluginConfig> = {
        TestPlugin: {
          name: 'TestPlugin',
          settings: {
            enable: {
              name: 'enable',
              type: 'types.bool',
              default: true,
            },
          },
        },
      };

      const genericOutput = generateNixModule(plugins, 'shared');
      const sharedPath = join(pluginsDir, 'shared.nix');
      await fse.writeFile(sharedPath, genericOutput);

      expect(await fse.pathExists(sharedPath)).toBe(true);
      const content = await fse.readFile(sharedPath, 'utf-8');
      expect(content).toContain('testPlugin');
      expect(content).toContain('mkEnableOption');
    } finally {
      await fse.remove(tempDir);
    }
  });

  test("creates output directory if it doesn't exist", async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const outputDir = join(tempDir, 'output');
    const pluginsDir = join(outputDir, 'plugins');

    try {
      // Directory shouldn't exist yet
      expect(await fse.pathExists(pluginsDir)).toBe(false);

      await fse.ensureDir(pluginsDir);

      // Directory should exist now
      expect(await fse.pathExists(pluginsDir)).toBe(true);
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('generates all three output files (shared, vencord, equicord)', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const outputDir = join(tempDir, 'output');
    const pluginsDir = join(outputDir, 'plugins');

    try {
      await fse.ensureDir(pluginsDir);

      const genericPlugins: Record<string, PluginConfig> = {
        SharedPlugin: {
          name: 'SharedPlugin',
          settings: {},
        },
      };

      const vencordPlugins: Record<string, PluginConfig> = {
        VencordPlugin: {
          name: 'VencordPlugin',
          settings: {},
        },
      };

      const equicordPlugins: Record<string, PluginConfig> = {
        EquicordPlugin: {
          name: 'EquicordPlugin',
          settings: {},
        },
      };

      const genericOutput = generateNixModule(genericPlugins, 'shared');
      const vencordOutput = generateNixModule(vencordPlugins, 'vencord');
      const equicordOutput = generateNixModule(equicordPlugins, 'equicord');

      await fse.writeFile(join(pluginsDir, 'shared.nix'), genericOutput);
      await fse.writeFile(join(pluginsDir, 'vencord.nix'), vencordOutput);
      await fse.writeFile(join(pluginsDir, 'equicord.nix'), equicordOutput);

      expect(await fse.pathExists(join(pluginsDir, 'shared.nix'))).toBe(true);
      expect(await fse.pathExists(join(pluginsDir, 'vencord.nix'))).toBe(true);
      expect(await fse.pathExists(join(pluginsDir, 'equicord.nix'))).toBe(true);

      const sharedContent = await fse.readFile(join(pluginsDir, 'shared.nix'), 'utf-8');
      expect(sharedContent).toContain('sharedPlugin');

      const vencordContent = await fse.readFile(join(pluginsDir, 'vencord.nix'), 'utf-8');
      expect(vencordContent).toContain('vencordPlugin');

      const equicordContent = await fse.readFile(join(pluginsDir, 'equicord.nix'), 'utf-8');
      expect(equicordContent).toContain('equicordPlugin');
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('CLI Error Handling', () => {
  test('handles missing vencord path gracefully', async () => {
    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const nonExistentPath = join(tempDir, 'nonexistent');

    try {
      // Should throw or handle error when path doesn't exist
      await expect(parsePlugins(nonExistentPath)).rejects.toThrow();
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('handles invalid plugin data structure', () => {
    const invalidData = {
      vencordPlugins: null,
      equicordPlugins: {},
    } as unknown as ParsedPluginsResult;

    const result = ParsedPluginsResultSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  test('validateParsedResults throws zod error for invalid vencord result', () => {
    const invalidResult = {
      vencordPlugins: 'not an object',
      equicordPlugins: {},
    } as unknown as ParsedPluginsResult;

    expect(() => {
      validateParsedResults(invalidResult);
    }).toThrow();
  });

  test('validateParsedResults throws zod error for invalid equicord result', () => {
    const validVencord: ParsedPluginsResult = {
      vencordPlugins: {
        Plugin1: {
          name: 'Plugin1',
          settings: {},
        },
      },
      equicordPlugins: {},
    };

    const invalidEquicord = {
      vencordPlugins: 'not an object',
      equicordPlugins: {},
    } as unknown as ParsedPluginsResult;

    expect(() => {
      validateParsedResults(validVencord, invalidEquicord);
    }).toThrow();
  });
});
