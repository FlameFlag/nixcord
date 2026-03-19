import { resolve } from 'pathe';
import { Command } from 'commander';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { runGeneratePluginOptions } from './runner/index.js';
import type { GeneratePluginOptionsParams } from './runner/index.js';
import { CLI_CONFIG } from '@nixcord/shared';
import { createLogger } from '@nixcord/shared';

const DEFAULT_OUTPUT = 'modules/plugins-generated.nix';

const CliOptionsSchema = z.object({
  equicord: z.string().optional(),
  output: z.string().min(1, 'Output path cannot be empty'),
  verbose: z.boolean(),
  vencord: z.string().optional(),
  vencordPlugins: z.string().min(1, 'Vencord plugins path cannot be empty'),
  equicordPlugins: z.string().min(1, 'Equicord plugins path cannot be empty'),
});

export class CliExecutionError extends Error {
  constructor(
    public readonly cause: Error,
    public readonly verbose: boolean
  ) {
    super(cause.message);
    this.name = 'CliExecutionError';
  }
}

export const buildCli = (): Command => {
  const program = new Command();

  return program
    .name('generate-plugin-options')
    .description('Extract Vencord/Equicord plugin settings and generate Nix configuration options')
    .version(CLI_CONFIG.version)
    .argument('[vencord-path]', 'Path to Vencord source directory')
    .option('--vencord <path>', 'Path to Vencord source directory (optional override)')
    .option('-e, --equicord <path>', 'Path to Equicord source directory (optional)')
    .option('-o, --output <path>', 'Output file path', DEFAULT_OUTPUT)
    .option(
      '--vencord-plugins <path>',
      'Relative path to Vencord plugins directory',
      CLI_CONFIG.directories.vencordPlugins
    )
    .option(
      '--equicord-plugins <path>',
      'Relative path to Equicord plugins directory',
      CLI_CONFIG.directories.equicordPlugins
    )
    .option('-v, --verbose', 'Enable verbose output', false)
    .action(async (vencordArg: string | undefined, options: unknown) => {
      // Run the options through Zod before we touch the filesystem; this mirrors how we catch
      // typos like `--vencrod` in our release scripts before the Equicord/Vencord paths are read
      const validationResult = CliOptionsSchema.safeParse(options);
      if (!validationResult.success) {
        const zodError = fromZodError(validationResult.error);
        throw new CliExecutionError(new Error(`Invalid CLI options: ${zodError.message}`), false);
      }

      const {
        equicord: equicordPath,
        output,
        verbose,
        vencord: vencordOption,
        vencordPlugins,
        equicordPlugins,
      } = validationResult.data;
      const vencordPath = vencordOption ?? vencordArg;
      if (!vencordPath) {
        throw new CliExecutionError(
          new Error('Missing Vencord source path. Provide --vencord or the positional argument.'),
          verbose
        );
      }

      const logger = createLogger(verbose);
      const resolvedOutputPath = resolve(process.cwd(), output);

      const baseParams: GeneratePluginOptionsParams = {
        vencordPath,
        outputPath: resolvedOutputPath,
        verbose,
        logger,
        vencordPluginsDir: vencordPlugins,
        equicordPluginsDir: equicordPlugins,
      };

      const params: GeneratePluginOptionsParams = equicordPath
        ? { ...baseParams, equicordPath }
        : baseParams;

      const result = await runGeneratePluginOptions(params);

      if (result.ok) {
        const summary = result.value;
        logger.success(
          `${CLI_CONFIG.symbols.success} Generated plugin options in ${summary.pluginsDir}:\n` +
            `  - ${CLI_CONFIG.filenames.shared}: ${summary.sharedCount} plugins (shared)\n` +
            `  - ${CLI_CONFIG.filenames.vencord}: ${summary.vencordOnlyCount} plugins (Vencord-only)\n` +
            `  - ${CLI_CONFIG.filenames.equicord}: ${summary.equicordOnlyCount} plugins (Equicord-only)\n` +
            `  - ${CLI_CONFIG.filenames.parseRules}: parser rename rules`
        );
      } else {
        throw new CliExecutionError(result.error, verbose);
      }
    });
};

export const runCli = async (argv = process.argv): Promise<void> => {
  const cli = buildCli();
  await cli.parseAsync(argv);
};

export const handleCliError = (error: unknown): void => {
  if (error instanceof CliExecutionError) {
    const logger = createLogger(error.verbose);
    logger.error(`Error: ${error.cause.message}`);
    if (error.verbose && error.cause.stack) {
      logger.debug(error.cause.stack);
    }
    process.exitCode = 1;
    return;
  }
  if (error instanceof Error) {
    const logger = createLogger(true);
    logger.error(error.message);
    if (error.stack) {
      logger.debug(error.stack);
    }
    process.exitCode = 1;
    return;
  }
  const logger = createLogger(true);
  logger.error(String(error));
  process.exitCode = 1;
};
