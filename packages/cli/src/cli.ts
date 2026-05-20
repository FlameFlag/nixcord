import { CLI_CONFIG, createLogger } from '@nixcord/shared';
import {
  type Application,
  buildApplication,
  buildCommand,
  type CommandContext,
  run,
} from '@stricli/core';
import { resolve } from 'pathe';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import type { GeneratePluginOptionsParams } from './runner/index.js';
import { runGeneratePluginOptions } from './runner/index.js';
import { logGeneratePluginOptionsSummary } from './summary.js';

const DEFAULT_OUTPUT = 'modules/plugins-generated.nix';
const DESCRIPTION =
  'Extract Vencord/Equicord plugin settings and generate Nix configuration options';

const CliOptionsSchema = z.object({
  equicord: z.string().optional(),
  output: z.string().min(1, 'Output path cannot be empty'),
  verbose: z.boolean(),
  vencord: z.string().optional(),
  version: z.boolean(),
  vencordPlugins: z.string().min(1, 'Vencord plugins path cannot be empty'),
  equicordPlugins: z.string().min(1, 'Equicord plugins path cannot be empty'),
  skipGitMigrations: z.boolean(),
});

type CliFlags = z.infer<typeof CliOptionsSchema>;
type CliArgs = [vencordArg?: string];

export class CliExecutionError extends Error {
  constructor(
    public readonly cause: Error,
    public readonly verbose: boolean
  ) {
    super(cause.message);
    this.name = 'CliExecutionError';
  }
}

const stringParser = (input: string): string => input;

export const buildCli = (): Application<CommandContext> => {
  const command = buildCommand<CliFlags, CliArgs>({
    docs: {
      brief: DESCRIPTION,
      fullDescription: DESCRIPTION,
    },
    parameters: {
      flags: {
        vencord: {
          kind: 'parsed',
          parse: stringParser,
          brief: `Path to Vencord source directory (default: ${CLI_CONFIG.sources.vencord})`,
          placeholder: 'path',
          optional: true,
        },
        equicord: {
          kind: 'parsed',
          parse: stringParser,
          brief: `Path to Equicord source directory (default: ${CLI_CONFIG.sources.equicord})`,
          placeholder: 'path',
          optional: true,
        },
        output: {
          kind: 'parsed',
          parse: stringParser,
          brief: 'Output file path',
          placeholder: 'path',
          default: DEFAULT_OUTPUT,
        },
        vencordPlugins: {
          kind: 'parsed',
          parse: stringParser,
          brief: 'Relative path to Vencord plugins directory',
          placeholder: 'path',
          default: CLI_CONFIG.directories.vencordPlugins,
        },
        equicordPlugins: {
          kind: 'parsed',
          parse: stringParser,
          brief: 'Relative path to Equicord plugins directory',
          placeholder: 'path',
          default: CLI_CONFIG.directories.equicordPlugins,
        },
        skipGitMigrations: {
          kind: 'boolean',
          brief: 'Do not inspect git history for plugin rename/removal migrations',
          default: false,
          withNegated: false,
        },
        verbose: {
          kind: 'boolean',
          brief: 'Enable verbose output',
          default: false,
          withNegated: false,
        },
        version: {
          kind: 'boolean',
          brief: 'Print version information and exit',
          default: false,
          withNegated: false,
        },
      },
      aliases: {
        e: 'equicord',
        o: 'output',
        v: 'verbose',
        V: 'version',
      },
      positional: {
        kind: 'tuple',
        parameters: [
          {
            parse: stringParser,
            brief: 'Path to Vencord source directory',
            placeholder: 'vencord-path',
            optional: true,
          },
        ],
      },
    },
    async func(flags, vencordArg) {
      // Run the options through Zod before we touch the filesystem; this mirrors how we catch
      // typos like `--vencrod` in our release scripts before the Equicord/Vencord paths are read.
      const validationResult = CliOptionsSchema.safeParse(flags);
      if (!validationResult.success) {
        const zodError = fromZodError(validationResult.error);
        return new CliExecutionError(new Error(`Invalid CLI options: ${zodError.message}`), false);
      }

      if (validationResult.data.version) {
        this.process.stdout.write(`${CLI_CONFIG.version}\n`);
        return;
      }

      const vencordPath = validationResult.data.vencord ?? vencordArg ?? CLI_CONFIG.sources.vencord;
      const equicordPath = validationResult.data.equicord ?? CLI_CONFIG.sources.equicord;

      const logger = createLogger(validationResult.data.verbose);
      const resolvedOutputPath = resolve(process.cwd(), validationResult.data.output);

      const baseParams: GeneratePluginOptionsParams = {
        vencordPath,
        outputPath: resolvedOutputPath,
        verbose: validationResult.data.verbose,
        logger,
        vencordPluginsDir: validationResult.data.vencordPlugins,
        equicordPluginsDir: validationResult.data.equicordPlugins,
        skipGitMigrations: validationResult.data.skipGitMigrations,
      };

      const params: GeneratePluginOptionsParams = { ...baseParams, equicordPath };

      const result = await runGeneratePluginOptions(params);

      if (!result.ok) {
        return new CliExecutionError(result.error, validationResult.data.verbose);
      }

      logGeneratePluginOptionsSummary(logger, result.value);
    },
  });

  return buildApplication(command, {
    name: 'generate-plugin-options',
    scanner: {
      caseStyle: 'allow-kebab-for-camel',
    },
    documentation: {
      caseStyle: 'convert-camel-to-kebab',
    },
  });
};

export const runCli = async (argv = process.argv): Promise<void> => {
  const cli = buildCli();
  await run(cli, argv.slice(2), { process });

  if (typeof process.exitCode === 'number' && process.exitCode < 0) {
    process.exitCode = 1;
  }
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
