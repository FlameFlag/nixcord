{ lib, ... }:
let
  # deepMergeAttrsList :: [attrset] -> attrset
  # Deep-merge a list of attribute sets (left to right).
  # Named to distinguish from lib.mergeAttrsList which does shallow merge.
  deepMergeAttrsList = list: builtins.foldl' lib.recursiveUpdate { } list;

  # applyPostPatch :: { cfg, pkg } -> derivation
  # Patch a Vencord/Equicord derivation to include user plugins.
  applyPostPatch =
    { cfg, pkg }:
    pkg.overrideAttrs (o: {
      postPatch =
        (o.postPatch or "")
        + lib.concatLines (
          lib.optional (cfg.userPlugins != { }) "mkdir -p src/userplugins"
          ++ lib.mapAttrsToList (
            name: path: "cp -r ${lib.escapeShellArg path} src/userplugins/${lib.escapeShellArg name}"
          ) cfg.userPlugins
        );

      postInstall = (o.postInstall or "") + ''
        cp package.json "$out"
      '';
    });

  # mkBrowserBuild :: { cfg, pkg, browserJsPath, browserCssPath } -> derivation
  # Builds a Vencord/Equicord browser bundle (for Legcord) from a desktop package,
  # including user plugins. Overrides the build to run `buildWeb` and extracts
  # browser.js / browser.css from the build output.
  mkBrowserBuild =
    {
      cfg,
      pkg,
      browserJsPath,
      browserCssPath,
    }:
    (applyPostPatch { inherit cfg pkg; }).overrideAttrs (old: {
      buildPhase = ''
        runHook preBuild
        pnpm run buildWeb -- --standalone --disable-updater
        runHook postBuild
      '';
      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        cp ${browserJsPath} "$out/browser.js"
        cp ${browserCssPath} "$out/browser.css"
        runHook postInstall
      '';
    });

  # mkIsQuickCssUsed :: { cfg } -> attrset -> bool
  # Returns whether quick CSS should be written for a given client config.
  mkIsQuickCssUsed =
    { cfg }:
    appConfig: (cfg.config.useQuickCss || (appConfig.useQuickCss or false)) && cfg.quickCss != "";

  # mkPluginKit :: { cfg } -> { filterPluginsFor, mkFullConfig, ... }
  # Builds plugin filtering and config merging utilities for the given configuration.
  mkPluginKit =
    { cfg }:
    let
      # Read JSON directly for plugin name masks — no need to generate full option declarations.
      sharedPluginNames = builtins.attrNames (
        builtins.fromJSON (builtins.readFile ../plugins/shared.json)
      );
      vencordPluginNames = builtins.attrNames (
        builtins.fromJSON (builtins.readFile ../plugins/vencord.json)
      );
      equicordPluginNames = builtins.attrNames (
        builtins.fromJSON (builtins.readFile ../plugins/equicord.json)
      );

      deprecated = builtins.fromJSON (builtins.readFile ../plugins/deprecated.json);
      migrations = builtins.fromJSON (builtins.readFile ../plugins/migrations.json);

      activePluginNames = sharedPluginNames ++ vencordPluginNames ++ equicordPluginNames;
      activePluginNamesByLowercase = lib.listToAttrs (
        map (name: {
          name = lib.toLower name;
          value = name;
        }) activePluginNames
      );
      normalizeActivePluginName =
        name: activePluginNamesByLowercase.${lib.toLower name} or name;

      deprecatedPluginNameMigrations = lib.mapAttrs (_: v: normalizeActivePluginName v.to) (
        deprecated.renames or { }
      );
      generatedPluginNameMigrations = lib.listToAttrs (
        map (migration: {
          name = builtins.elemAt migration.from 0;
          value = builtins.elemAt migration.to 0;
        }) (
          lib.filter (
            migration:
            builtins.length (migration.from or [ ]) == 2
            && builtins.elemAt migration.from 1 == "enable"
            && builtins.length (migration.to or [ ]) >= 1
          ) (migrations.renames or [ ])
        )
      );
      pluginNameMigrations = deprecatedPluginNameMigrations // generatedPluginNameMigrations;

      isPluginEnabled = pluginConfig: pluginConfig.enable or false;

      collectDeprecatedPlugins =
        configAttrs:
        let
          plugins = configAttrs.plugins or { };
        in
        lib.filter (oldName: builtins.hasAttr oldName plugins && isPluginEnabled plugins.${oldName}) (
          builtins.attrNames pluginNameMigrations
        );

      # Attrset masks for O(1) lookups instead of O(n) builtins.elem on lists.
      sharedMask = lib.genAttrs sharedPluginNames (_: null);
      vencordMask = lib.genAttrs vencordPluginNames (_: null);
      equicordMask = lib.genAttrs equicordPluginNames (_: null);

      # collectEnabledExclusivePlugins :: attrset -> attrset -> attrset -> [string]
      # Returns names of enabled plugins that belong exclusively to `targetSet`
      # (i.e. not in shared or `otherSet`).
      collectEnabledExclusivePlugins =
        targetSet: otherMask: configAttrs:
        let
          plugins = configAttrs.plugins or { };
        in
        builtins.attrNames (
          lib.filterAttrs (
            name: value:
            targetSet ? ${name} && !(sharedMask ? ${name}) && !(otherMask ? ${name}) && isPluginEnabled value
          ) plugins
        );

      collectEnabledEquicordOnlyPlugins = collectEnabledExclusivePlugins equicordMask vencordMask;
      collectEnabledVencordOnlyPlugins = collectEnabledExclusivePlugins vencordMask equicordMask;

      filterPluginsFor =
        client: configAttrs:
        let
          mask =
            sharedMask
            // (
              if client == "vencord" then
                vencordMask
              else if client == "equicord" then
                equicordMask
              else
                { }
            );
          plugins = configAttrs.plugins or { };
        in
        configAttrs // { plugins = builtins.intersectAttrs mask plugins; };

      filterPluginsForClient =
        configAttrs:
        filterPluginsFor (
          if cfg.discord.vencord.enable then
            "vencord"
          else if cfg.discord.equicord.enable then
            "equicord"
          else
            "none"
        ) configAttrs;

      mkFullConfig =
        {
          baseConfig,
          extraConfig ? { },
          clientConfig ? { },
          client ? null,
        }:
        let
          filteredBaseConfig =
            if client != null then filterPluginsFor client baseConfig else filterPluginsForClient baseConfig;
        in
        deepMergeAttrsList [
          filteredBaseConfig
          extraConfig
          clientConfig
        ];
    in
    {
      inherit
        pluginNameMigrations
        collectDeprecatedPlugins
        collectEnabledEquicordOnlyPlugins
        collectEnabledVencordOnlyPlugins
        filterPluginsFor
        filterPluginsForClient
        mkFullConfig
        ;
    };

  # mkCopyCommands :: { lib, cfg, ...files } -> string
  # Generates shell commands to copy all settings/theme files to their destinations.
  mkCopyCommands =
    {
      lib,
      cfg,
      quickCssFile,
      vencordSettingsFile,
      equicordSettingsFile,
      discordSettingsFile,
      vesktopSettingsFile,
      vesktopClientSettingsFile,
      vesktopStateFile,
      vesktopThemes,
      equibopSettingsFile,
      equibopClientSettingsFile,
      equibopStateFile,
      dorionConfigFile,
      legcordSettingsFile,
      legcordVencordWeb,
      legcordEquicordWeb,
      isQuickCssUsed,
    }:
    let
      mkCopy = src: dest: "copy_file ${src} ${lib.escapeShellArg dest} 0644";

      quickCssEnabled = cfg.quickCss != "";
      quickCssOnDiscord =
        cfg.discord.enable
        && quickCssEnabled
        && lib.any isQuickCssUsed [
          cfg.vencordConfig
          cfg.equicordConfig
        ];
      quickCssOnVesktop = cfg.vesktop.enable && quickCssEnabled && isQuickCssUsed cfg.vesktopConfig;
      quickCssOnEquibop = cfg.equibop.enable && quickCssEnabled && isQuickCssUsed cfg.equibopConfig;

      discordCopies =
        lib.optionals quickCssOnDiscord [
          (mkCopy quickCssFile "${cfg.configDir}/settings/quickCss.css")
        ]
        ++ lib.optionals cfg.discord.vencord.enable [
          (mkCopy vencordSettingsFile "${cfg.configDir}/settings/settings.json")
        ]
        ++ lib.optionals cfg.discord.equicord.enable [
          (mkCopy equicordSettingsFile "${cfg.configDir}/settings/settings.json")
        ]
        ++ lib.optionals (cfg.discord.settings != { }) [
          (mkCopy discordSettingsFile "${cfg.discord.configDir}/settings.json")
        ];

      vesktopCopies =
        lib.optionals cfg.vesktop.enable [
          (mkCopy vesktopSettingsFile "${cfg.vesktop.configDir}/settings/settings.json")
        ]
        ++ lib.optionals (cfg.vesktop.enable && vesktopClientSettingsFile != null) [
          (mkCopy vesktopClientSettingsFile "${cfg.vesktop.configDir}/settings.json")
        ]
        ++ lib.optionals (cfg.vesktop.enable && vesktopStateFile != null) [
          (mkCopy vesktopStateFile "${cfg.vesktop.configDir}/state.json")
        ]
        ++ lib.optionals cfg.vesktop.enable (
          lib.mapAttrsToList (
            name: path: mkCopy path "${cfg.vesktop.configDir}/themes/${name}.css"
          ) vesktopThemes
        )
        ++ lib.optionals quickCssOnVesktop [
          (mkCopy quickCssFile "${cfg.vesktop.configDir}/settings/quickCss.css")
        ];

      equibopCopies =
        lib.optionals cfg.equibop.enable [
          (mkCopy equibopSettingsFile "${cfg.equibop.configDir}/settings/settings.json")
        ]
        ++ lib.optionals (cfg.equibop.enable && equibopClientSettingsFile != null) [
          (mkCopy equibopClientSettingsFile "${cfg.equibop.configDir}/settings.json")
        ]
        ++ lib.optionals (cfg.equibop.enable && equibopStateFile != null) [
          (mkCopy equibopStateFile "${cfg.equibop.configDir}/state.json")
        ]
        ++ lib.optionals quickCssOnEquibop [
          (mkCopy quickCssFile "${cfg.equibop.configDir}/settings/quickCss.css")
        ];

      dorionCopies = lib.optionals (cfg.dorion.enable && dorionConfigFile != null) [
        (mkCopy dorionConfigFile "${cfg.dorion.configDir}/config.json")
      ];

      legcordCopies =
        lib.optionals (cfg.legcord.enable && legcordSettingsFile != null) [
          (mkCopy legcordSettingsFile "${cfg.legcord.configDir}/storage/settings.json")
        ]
        ++ lib.optionals (cfg.legcord.enable && legcordVencordWeb != null) [
          (mkCopy "${legcordVencordWeb}/browser.js" "${cfg.legcord.configDir}/vencord.js")
          (mkCopy "${legcordVencordWeb}/browser.css" "${cfg.legcord.configDir}/vencord.css")
        ]
        ++ lib.optionals (cfg.legcord.enable && legcordEquicordWeb != null) [
          (mkCopy "${legcordEquicordWeb}/browser.js" "${cfg.legcord.configDir}/equicord.js")
          (mkCopy "${legcordEquicordWeb}/browser.css" "${cfg.legcord.configDir}/equicord.css")
        ];
    in
    lib.concatStringsSep "\n" (
      discordCopies ++ vesktopCopies ++ equibopCopies ++ dorionCopies ++ legcordCopies
    );
  # toSnakeCase :: string -> string
  # Converts a camelCase string to snake_case.
  toSnakeCase =
    str:
    lib.pipe str [
      (builtins.split "([A-Z])")
      (builtins.foldl' (
        acc: part:
        if builtins.isList part then acc + "_" + (lib.toLower (builtins.elemAt part 0)) else acc + part
      ) "")
      (builtins.replaceStrings [ "__" ] [ "_" ])
    ];

  # mkDorionConfigAttrs :: { cfg } -> attrset
  # Builds the Dorion config.json attribute set from module options.
  mkDorionConfigAttrs =
    { cfg }:
    let
      dorionConfig = {
        autoupdate = false;
      }
      // (lib.mapAttrs' (name: value: {
        name = toSnakeCase name;
        inherit value;
      }) (builtins.removeAttrs cfg.dorion [ "extraSettings" ]));
    in
    dorionConfig // cfg.dorion.extraSettings;

  # mkAssertions :: { cfg, collectEnabledEquicordOnlyPlugins, collectEnabledVencordOnlyPlugins } -> [assertion]
  # Generates NixOS assertions for mutually-exclusive client and plugin constraints.
  mkAssertions =
    {
      cfg,
      collectEnabledEquicordOnlyPlugins,
      collectEnabledVencordOnlyPlugins,
    }:
    let
      allPlugins = {
        plugins =
          (cfg.config.plugins or { })
          // (cfg.extraConfig.plugins or { })
          // (cfg.vencordConfig.plugins or { })
          // (cfg.equicordConfig.plugins or { })
          // (cfg.vesktopConfig.plugins or { })
          // (cfg.equibopConfig.plugins or { });
      };
      wrongEquicordPlugins = collectEnabledEquicordOnlyPlugins allPlugins;
      wrongVencordPlugins = collectEnabledVencordOnlyPlugins allPlugins;
      hasVencordClient = cfg.discord.vencord.enable || cfg.vesktop.enable || cfg.legcord.vencord.enable;
      hasEquicordClient =
        cfg.discord.equicord.enable || cfg.equibop.enable || cfg.legcord.equicord.enable;
    in
    [
      {
        assertion = !(cfg.discord.vencord.enable && cfg.discord.equicord.enable);
        message = "programs.nixcord.discord.vencord.enable and programs.nixcord.discord.equicord.enable cannot both be enabled at the same time. They are mutually exclusive.";
      }
      {
        assertion = !(cfg.legcord.vencord.enable && cfg.legcord.equicord.enable);
        message = "programs.nixcord.legcord.vencord.enable and programs.nixcord.legcord.equicord.enable cannot both be enabled at the same time. They are mutually exclusive.";
      }
      {
        assertion = !(hasVencordClient && !hasEquicordClient) || wrongEquicordPlugins == [ ];
        message = "The following Equicord-only plugins are enabled but only Vencord-based clients are active: ${lib.concatStringsSep ", " wrongEquicordPlugins}. These plugins are not available in Vencord.";
      }
      {
        assertion = !(hasEquicordClient && !hasVencordClient) || wrongVencordPlugins == [ ];
        message = "The following Vencord-only plugins are enabled but only Equicord-based clients are active: ${lib.concatStringsSep ", " wrongVencordPlugins}. These plugins are not available in Equicord.";
      }
    ];

  # mkSettingsFiles :: { pkgs, cfg, mkVencordCfg, ...configs } -> { *File :: path | null }
  # Creates derivations for all client settings/state JSON files.
  mkSettingsFiles =
    {
      pkgs,
      cfg,
      mkVencordCfg,
      vencordFullConfig,
      equicordFullConfig,
      vesktopFullConfig,
      equibopFullConfig,
    }:
    let
      disabledUpdateSettings = {
        SKIP_HOST_UPDATE = true;
        SKIP_MODULE_UPDATE = true;
        USE_NEW_UPDATER = false;
      };
      discordSettings = cfg.discord.settings // disabledUpdateSettings;
    in
    {
      vencordSettingsFile = pkgs.writeText "nixcord-settings.json" (
        builtins.toJSON (mkVencordCfg vencordFullConfig)
      );
      equicordSettingsFile = pkgs.writeText "nixcord-equicord-settings.json" (
        builtins.toJSON (mkVencordCfg equicordFullConfig)
      );
      discordSettingsFile =
        if cfg.discord.settings != { } then
          pkgs.writeText "nixcord-discord-settings.json" (builtins.toJSON (mkVencordCfg discordSettings))
        else
          null;
      vesktopSettingsFile = pkgs.writeText "nixcord-vesktop-settings.json" (
        builtins.toJSON (mkVencordCfg vesktopFullConfig)
      );
      vesktopClientSettingsFile =
        if cfg.vesktop.settings != { } then
          pkgs.writeText "nixcord-vesktop-client-settings.json" (
            builtins.toJSON (mkVencordCfg cfg.vesktop.settings)
          )
        else
          null;
      vesktopStateFile =
        if cfg.vesktop.state != { } then
          pkgs.writeText "nixcord-vesktop-state.json" (builtins.toJSON (mkVencordCfg cfg.vesktop.state))
        else
          null;
      equibopSettingsFile = pkgs.writeText "nixcord-equibop-settings.json" (
        builtins.toJSON (mkVencordCfg equibopFullConfig)
      );
      equibopClientSettingsFile =
        if cfg.equibop.settings != { } then
          pkgs.writeText "nixcord-equibop-client-settings.json" (
            builtins.toJSON (mkVencordCfg cfg.equibop.settings)
          )
        else
          null;
      equibopStateFile =
        if cfg.equibop.state != { } then
          pkgs.writeText "nixcord-equibop-state.json" (builtins.toJSON (mkVencordCfg cfg.equibop.state))
        else
          null;
    };

  # mkThemeFile :: { pkgs } -> string -> (path | string) -> path
  # Resolves a theme value to a store path (either a direct path or a writeText derivation).
  mkThemeFile =
    { pkgs }:
    name: value:
    if builtins.isPath value || lib.isStorePath value then
      value
    else
      pkgs.writeText "nixcord-theme-${name}.css" value;

  # branchDirName :: string -> string
  # Maps a Discord branch name to its config directory name.
  branchDirName = {
    stable = "discord";
    ptb = "discordptb";
    canary = "discordcanary";
    development = "discorddevelopment";
  };

  # mkConfigDirs :: { cfg, basePath } -> attrset
  # Computes all configDir defaults for a given base path.
  mkConfigDirs =
    { cfg, basePath }:
    {
      discord.configDir = lib.mkDefault "${basePath}/${branchDirName.${cfg.discord.branch} or "discord"}";
      configDir = lib.mkDefault "${basePath}/${
        if cfg.discord.equicord.enable then "Equicord" else "Vencord"
      }";
      vesktop.configDir = lib.mkDefault "${basePath}/vesktop";
      equibop.configDir = lib.mkDefault "${basePath}/equibop";
      dorion.configDir = lib.mkDefault "${basePath}/dorion";
      legcord.configDir = lib.mkDefault "${basePath}/legcord";
    };

  # mkAllFullConfigs :: { cfg, pluginKit } -> { vencord, equicord, vesktop, equibop }
  # Assembles full merged configs for all clients.
  mkAllFullConfigs =
    { cfg, pluginKit }:
    let
      inherit (pluginKit) mkFullConfig;
    in
    {
      vencordFullConfig = mkFullConfig {
        baseConfig = cfg.config;
        extraConfig = cfg.extraConfig;
        clientConfig = cfg.vencordConfig;
      };
      equicordFullConfig = mkFullConfig {
        baseConfig = cfg.config;
        extraConfig = cfg.extraConfig;
        clientConfig = cfg.equicordConfig;
      };
      vesktopFullConfig = mkFullConfig {
        baseConfig = cfg.config;
        extraConfig = cfg.extraConfig;
        clientConfig = cfg.vesktopConfig;
        client = "vencord";
      };
      equibopFullConfig = mkFullConfig {
        baseConfig = cfg.config;
        extraConfig = cfg.extraConfig;
        clientConfig = cfg.equibopConfig;
        client = "equicord";
      };
    };
in
{
  inherit
    deepMergeAttrsList
    applyPostPatch
    mkBrowserBuild
    mkIsQuickCssUsed
    mkPluginKit
    mkCopyCommands
    toSnakeCase
    mkDorionConfigAttrs
    mkAssertions
    mkSettingsFiles
    mkThemeFile
    mkConfigDirs
    mkAllFullConfigs
    ;
}
