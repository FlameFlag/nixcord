import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_CONFIG, Err, Ok } from '@nixcord/shared';
import fse from 'fs-extra';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildCli, CliExecutionError, handleCliError, runCli } from '../../src/cli.js';
import { runGeneratePluginOptions } from '../../src/runner/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

vi.mock('../../src/runner/index.js', () => ({
  runGeneratePluginOptions: vi.fn(),
}));

vi.mock('@nixcord/shared', async (orig) => ({
  ...(await orig()),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('buildCli', () => {
  const cli = buildCli();
  test('builds a Stricli application with correct name and description', () => {
    expect(cli.config.name).toBe('generate-plugin-options');
    expect(cli.root.brief).toBe(
      'Extract Vencord/Equicord plugin settings and generate Nix configuration options'
    );
  });

  test('has a version flag', () => {
    expect(cli.root.usesFlag('version')).toBe(true);
  });

  test('has all expected options', () => {
    const flags = Object.keys(cli.root.parameters.flags ?? {});

    expect(flags).toContain('vencord');
    expect(flags).toContain('equicord');
    expect(flags).toContain('output');
    expect(flags).toContain('vencordPlugins');
    expect(flags).toContain('equicordPlugins');
    expect(flags).toContain('verbose');
  });

  test('has positional argument for vencord path', () => {
    const positional = cli.root.parameters.positional;
    expect(positional?.kind).toBe('tuple');
    if (positional?.kind === 'tuple') {
      expect(positional.parameters[0]?.placeholder).toBe('vencord-path');
    }
  });
});

describe('CLI Argument Parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('accepts vencord path as positional argument', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli(['node', 'cli.js', vencordDir, '--output', join(tempDir, 'output.nix')]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPath: vencordDir,
          vencordPluginsDir: CLI_CONFIG.directories.vencordPlugins,
          equicordPluginsDir: CLI_CONFIG.directories.equicordPlugins,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('accepts vencord path via --vencord flag', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli([
        'node',
        'cli.js',
        '--vencord',
        vencordDir,
        '--output',
        join(tempDir, 'output.nix'),
      ]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPath: vencordDir,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('--vencord flag overrides positional argument', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir1 = join(tempDir, 'vencord1');
    const vencordDir2 = join(tempDir, 'vencord2');
    await fse.ensureDir(vencordDir1);
    await fse.ensureDir(vencordDir2);
    await fse.writeFile(join(vencordDir1, 'package.json'), '{}');
    await fse.writeFile(join(vencordDir2, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir1, 'src', 'plugins'));
    await fse.ensureDir(join(vencordDir2, 'src', 'plugins'));

    try {
      await runCli([
        'node',
        'cli.js',
        vencordDir1,
        '--vencord',
        vencordDir2,
        '--output',
        join(tempDir, 'output.nix'),
      ]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPath: vencordDir2, // Should use flag value, not positional
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('uses packaged upstream sources when source paths are omitted', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };
    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));

    try {
      await runCli(['node', 'cli.js', '--output', join(tempDir, 'output.nix')]);
      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPath: CLI_CONFIG.sources.vencord,
          equicordPath: CLI_CONFIG.sources.equicord,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('accepts equicord path via --equicord flag', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    const equicordDir = join(tempDir, 'equicord');
    await fse.ensureDir(vencordDir);
    await fse.ensureDir(equicordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.writeFile(join(equicordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));
    await fse.ensureDir(join(equicordDir, 'src', 'plugins'));

    try {
      await runCli([
        'node',
        'cli.js',
        vencordDir,
        '--equicord',
        equicordDir,
        '--output',
        join(tempDir, 'output.nix'),
      ]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPath: vencordDir,
          equicordPath: equicordDir,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('uses default output path when not specified', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli(['node', 'cli.js', vencordDir]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          outputPath: expect.stringContaining('plugins-generated.nix'),
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('accepts custom output path', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    const customOutput = join(tempDir, 'custom-output.nix');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli(['node', 'cli.js', vencordDir, '--output', customOutput]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          outputPath: customOutput,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('uses default plugin directories when not specified', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli(['node', 'cli.js', vencordDir, '--output', join(tempDir, 'output.nix')]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPluginsDir: CLI_CONFIG.directories.vencordPlugins,
          equicordPluginsDir: CLI_CONFIG.directories.equicordPlugins,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('accepts custom vencord plugins directory', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'custom', 'plugins'));

    try {
      await runCli([
        'node',
        'cli.js',
        vencordDir,
        '--vencord-plugins',
        'custom/plugins',
        '--output',
        join(tempDir, 'output.nix'),
      ]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          vencordPluginsDir: 'custom/plugins',
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('accepts custom equicord plugins directory', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli([
        'node',
        'cli.js',
        vencordDir,
        '--equicord-plugins',
        'custom/equicordplugins',
        '--output',
        join(tempDir, 'output.nix'),
      ]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          equicordPluginsDir: 'custom/equicordplugins',
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });

  test('passes verbose flag correctly', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli([
        'node',
        'cli.js',
        vencordDir,
        '--verbose',
        '--output',
        join(tempDir, 'output.nix'),
      ]);

      expect(runGeneratePluginOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
        })
      );
    } finally {
      await fse.remove(tempDir);
    }
  });
});

describe('CLI Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('handles runner errors correctly', async () => {
    const mockError = new Error('Runner failed');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Err(mockError));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli(['node', 'cli.js', vencordDir, '--output', join(tempDir, 'output.nix')]);
      expect(process.exitCode).toBe(1);
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Runner failed'));
    } finally {
      stderrWrite.mockRestore();
      await fse.remove(tempDir);
    }
  });

  test('handleCliError sets exit code for CliExecutionError', () => {
    const error = new CliExecutionError(new Error('Test error'), false);
    handleCliError(error);
    expect(process.exitCode).toBe(1);
  });

  test('handleCliError sets exit code for generic Error', () => {
    const error = new Error('Generic error');
    handleCliError(error);
    expect(process.exitCode).toBe(1);
  });

  test('handleCliError sets exit code for non-Error values', () => {
    handleCliError('String error');
    expect(process.exitCode).toBe(1);
  });

  test('CliExecutionError preserves cause and verbose flag', () => {
    const cause = new Error('Original error');
    const error = new CliExecutionError(cause, true);
    expect(error.cause).toBe(cause);
    expect(error.verbose).toBe(true);
    expect(error.message).toBe('Original error');
    expect(error.name).toBe('CliExecutionError');
  });
});

describe('runCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('calls buildCli and parses argv', async () => {
    const mockSummary = {
      pluginsDir: '/tmp/plugins',
      sharedCount: 5,
      vencordOnlyCount: 3,
      equicordOnlyCount: 2,
    };

    vi.mocked(runGeneratePluginOptions).mockResolvedValue(Ok(mockSummary));

    const tempDir = await fse.mkdtemp(join(__dirname, 'test-cli-'));
    const vencordDir = join(tempDir, 'vencord');
    await fse.ensureDir(vencordDir);
    await fse.writeFile(join(vencordDir, 'package.json'), '{}');
    await fse.ensureDir(join(vencordDir, 'src', 'plugins'));

    try {
      await runCli(['node', 'cli.js', vencordDir, '--output', join(tempDir, 'output.nix')]);
      expect(runGeneratePluginOptions).toHaveBeenCalled();
    } finally {
      await fse.remove(tempDir);
    }
  });
});
