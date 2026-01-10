{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.nixcord;

  inherit (lib)
    mkIf
    mkMerge
    attrsets
    lists
    types
    ;

  dop = with types; coercedTo package (a: a.outPath) pathInStore;

  recursiveUpdateAttrsList =
    list:
    if (builtins.length list <= 1) then
      (builtins.elemAt list 0)
    else
      recursiveUpdateAttrsList (
        [
          (attrsets.recursiveUpdate (builtins.elemAt list 0) (builtins.elemAt list 1))
        ]
        ++ (lists.drop 2 list)
      );

  applyPostPatch =
    pkg:
    pkg.overrideAttrs (o: {
      postPatch =
        (o.postPatch or "")
        + lib.concatLines (
          lib.optional (cfg.userPlugins != { }) "mkdir -p src/userplugins"
          ++ lib.mapAttrsToList (
            name: path:
            "ln -s ${lib.escapeShellArg path} src/userplugins/${lib.escapeShellArg name} && ls src/userplugins"
          ) cfg.userPlugins
        );

      postInstall = (o.postInstall or "") + ''
        cp package.json $out
      '';
    });

  defaultVencord = applyPostPatch (
    pkgs.callPackage ../pkgs/vencord.nix { unstable = cfg.discord.vencord.unstable; }
  );

  parseRules = cfg.parseRules;

  inherit (pkgs.callPackage ./lib/core.nix { inherit lib parseRules; })
    mkVencordCfg
    mkFinalPackages
    ;

  activationScripts = import ./lib/activation.nix {
    inherit
      lib
      pkgs
      cfg
      config
      mkVencordCfg
      ;
  };
in
{
  options.programs.nixcord = import ./options.nix {
    inherit
      lib
      pkgs
      config
      dop
      defaultVencord
      ;
  };

  config =
    let
      vencord = applyPostPatch cfg.discord.vencord.package;
      equicord = applyPostPatch cfg.discord.equicord.package;

      isQuickCssUsed =
        appConfig:
        (cfg.config.useQuickCss || appConfig ? "useQuickCss" && appConfig.useQuickCss)
        && cfg.quickCss != "";

      sharedPlugins = import ./plugins/shared.nix { inherit lib; };
      vencordOnlyPlugins = import ./plugins/vencord.nix { inherit lib; };
      equicordOnlyPlugins = import ./plugins/equicord.nix { inherit lib; };

      pluginNameMigrations = import ./plugins/deprecated.nix;

      # Migrate plugin names from old to new
      migratePluginNames =
        configAttrs:
        let
          plugins = configAttrs.plugins or { };
          # Start with plugins that don't need migration (exclude old names)
          basePlugins = lib.filterAttrs (name: _: !(pluginNameMigrations ? ${name})) plugins;
          # Migrate each old plugin name to its new name
          migratedPlugins = lib.foldl' (
            acc: oldName:
            if plugins ? ${oldName} then
              let
                newName = pluginNameMigrations.${oldName};
                oldValue = plugins.${oldName};
                # If new name already exists in base, merge them (migrated value takes precedence)
                existingValue = basePlugins.${newName} or { };
                mergedValue = lib.recursiveUpdate existingValue oldValue;
              in
              acc // { ${newName} = mergedValue; }
            else
              acc
          ) { } (builtins.attrNames pluginNameMigrations);
          # Combine: base plugins (without old names) + migrated plugins
          cleanedPlugins = basePlugins // migratedPlugins;
        in
        configAttrs // { plugins = cleanedPlugins; };

      # Collect deprecated plugin names used in config (checks all config sources)
      collectDeprecatedPlugins =
        configAttrs:
        let
          plugins = configAttrs.plugins or { };
          extraPlugins = cfg.extraConfig.plugins or { };
          vencordPlugins = cfg.vencordConfig.plugins or { };
          equicordPlugins = cfg.equicordConfig.plugins or { };
          allPlugins = plugins // extraPlugins // vencordPlugins // equicordPlugins;
        in
        lib.filter (oldName: allPlugins ? ${oldName} && isPluginEnabled allPlugins.${oldName}) (
          builtins.attrNames pluginNameMigrations
        );

      # Check if a plugin is enabled
      isPluginEnabled =
        pluginConfig: if builtins.isAttrs pluginConfig then pluginConfig.enable or false else false;

      # Collect enabled Equicord-only plugins from all config sources
      # A plugin is Equicord-only if it exists in equicordOnlyPlugins but NOT in sharedPlugins or vencordOnlyPlugins
      collectEnabledEquicordOnlyPlugins =
        let
          plugins = cfg.config.plugins or { };
          extraPlugins = cfg.extraConfig.plugins or { };
          vencordPlugins = cfg.vencordConfig.plugins or { };
          equicordPlugins = cfg.equicordConfig.plugins or { };
          equibopPlugins = cfg.equibopConfig.plugins or { };
          allPlugins = plugins // extraPlugins // vencordPlugins // equicordPlugins // equibopPlugins;
          sharedPluginNames = builtins.attrNames sharedPlugins;
          vencordOnlyPluginNames = builtins.attrNames vencordOnlyPlugins;
          equicordOnlyPluginNames = builtins.attrNames equicordOnlyPlugins;
          # True Equicord-only plugins: in equicordOnlyPlugins but not in shared or vencord-only
          trulyEquicordOnlyPluginNames = lib.filter (
            name: !(builtins.elem name sharedPluginNames) && !(builtins.elem name vencordOnlyPluginNames)
          ) equicordOnlyPluginNames;
          enabledEquicordPlugins = lib.filterAttrs (
            name: value: builtins.elem name trulyEquicordOnlyPluginNames && isPluginEnabled value
          ) allPlugins;
        in
        builtins.attrNames enabledEquicordPlugins;

      # Collect enabled Vencord-only plugins from all config sources
      # A plugin is Vencord-only if it exists in vencordOnlyPlugins but NOT in sharedPlugins
      collectEnabledVencordOnlyPlugins =
        let
          plugins = cfg.config.plugins or { };
          extraPlugins = cfg.extraConfig.plugins or { };
          vencordPlugins = cfg.vencordConfig.plugins or { };
          equicordPlugins = cfg.equicordConfig.plugins or { };
          allPlugins = plugins // extraPlugins // vencordPlugins // equicordPlugins;
          sharedPluginNames = builtins.attrNames sharedPlugins;
          vencordOnlyPluginNames = builtins.attrNames vencordOnlyPlugins;
          # True Vencord-only plugins: in vencordOnlyPlugins but not in shared
          trulyVencordOnlyPluginNames = lib.filter (
            name: !(builtins.elem name sharedPluginNames)
          ) vencordOnlyPluginNames;
          enabledVencordPlugins = lib.filterAttrs (
            name: value: builtins.elem name trulyVencordOnlyPluginNames && isPluginEnabled value
          ) allPlugins;
        in
        builtins.attrNames enabledVencordPlugins;

      # Filter plugins based on which client is enabled
      # When vencord: shared + vencord-only (exclude equicord-only)
      # When equicord: shared + equicord-only (exclude vencord-only)
      filterPluginsForClient =
        configAttrs:
        let
          # Get all plugin names from each category
          sharedPluginNames = builtins.attrNames sharedPlugins;
          vencordOnlyPluginNames = builtins.attrNames vencordOnlyPlugins;
          equicordOnlyPluginNames = builtins.attrNames equicordOnlyPlugins;

          # Determine which plugins to include based on enabled client
          allowedPluginNames =
            sharedPluginNames
            ++ (
              if cfg.discord.vencord.enable then
                vencordOnlyPluginNames
              else if cfg.discord.equicord.enable then
                equicordOnlyPluginNames
              else
                [ ]
            );

          # Filter the plugins attribute set
          plugins = configAttrs.plugins or { };
          filteredPlugins = lib.filterAttrs (name: value: builtins.elem name allowedPluginNames) plugins;
        in
        configAttrs // { inherit filteredPlugins; };
    in
    mkIf cfg.enable (mkMerge [
      {
        assertions = [
          {
            assertion = !(cfg.discord.vencord.package != defaultVencord && cfg.discord.vencord.unstable);
            message = "programs.nixcord.discord.vencord: Cannot set both 'package' and 'unstable = true'. Choose one or the other.";
          }
          {
            assertion = !(cfg.discord.vencord.enable && cfg.discord.equicord.enable);
            message = "programs.nixcord.discord: Cannot enable both Vencord and Equicord at the same time. Choose one or the other.";
          }
          {
            assertion =
              !(
                !cfg.discord.equicord.enable
                && !cfg.equibop.enable
                && (builtins.length collectEnabledEquicordOnlyPlugins > 0)
              );
            message = "programs.nixcord: Cannot enable Equicord-only plugins when both Equicord and Equibop are disabled. Enabled plugins: ${lib.concatStringsSep ", " collectEnabledEquicordOnlyPlugins}. Either enable Equicord (discord.equicord.enable = true) or Equibop (equibop.enable = true), or disable these plugins.";
          }
          {
            assertion =
              !(!cfg.discord.vencord.enable && (builtins.length collectEnabledVencordOnlyPlugins > 0));
            message = "programs.nixcord: Cannot enable Vencord-only plugins when Vencord is disabled. Enabled plugins: ${lib.concatStringsSep ", " collectEnabledVencordOnlyPlugins}. Either enable Vencord (discord.vencord.enable = true) or disable these plugins.";
          }
          {
            assertion = !(cfg.equibop.enable && !pkgs.stdenvNoCC.isLinux && cfg.equibop.package != null);
            message = "programs.nixcord.equibop: Equibop package is only available on Linux. On macOS, set programs.nixcord.equibop.package = null and install Equibop outside of Nix.";
          }
        ];

        programs.nixcord.finalPackage = mkFinalPackages {
          inherit cfg;
          inherit vencord equicord;
        };

        home.packages = [
          (mkIf (cfg.discord.enable && cfg.discord.installPackage) cfg.finalPackage.discord)
          (mkIf (cfg.vesktop.enable && cfg.vesktop.installPackage) cfg.finalPackage.vesktop)
          (mkIf (
            cfg.equibop.enable && cfg.finalPackage.equibop != null && cfg.equibop.installPackage
          ) cfg.finalPackage.equibop)
          (mkIf (cfg.dorion.enable cfg.dorion.installPackage) cfg.finalPackage.dorion)
        ];
      }
      (mkIf cfg.discord.enable (mkMerge [
        {
          home.activation.disableDiscordUpdates = activationScripts.disableDiscordUpdates;
          home.activation.fixDiscordModules = activationScripts.fixDiscordModules;
        }
        # QuickCSS
        (mkIf (isQuickCssUsed cfg.vencordConfig || isQuickCssUsed cfg.equicordConfig) {
          home.file."${cfg.configDir}/settings/quickCss.css".text = cfg.quickCss;
        })
        # Vencord Settings
        (mkIf cfg.discord.vencord.enable (
          let
            migratedConfig = migratePluginNames cfg.config;
            migratedExtraConfig = migratePluginNames cfg.extraConfig;
            migratedVencordConfig = migratePluginNames cfg.vencordConfig;
            filteredConfig = filterPluginsForClient migratedConfig;
            fullConfig = recursiveUpdateAttrsList [
              (filteredConfig // { plugins = filteredConfig.filteredPlugins; })
              migratedExtraConfig
              migratedVencordConfig
            ];
          in
          {
            home.file."${cfg.configDir}/settings/settings.json".text = builtins.toJSON (
              mkVencordCfg fullConfig
            );
          }
        ))
        # Equicord Settings
        (mkIf cfg.discord.equicord.enable (
          let
            migratedConfig = migratePluginNames cfg.config;
            migratedExtraConfig = migratePluginNames cfg.extraConfig;
            migratedEquicordConfig = migratePluginNames cfg.equicordConfig;
            filteredConfig = filterPluginsForClient migratedConfig;
            fullConfig = recursiveUpdateAttrsList [
              (filteredConfig // { plugins = filteredConfig.filteredPlugins; })
              migratedExtraConfig
              migratedEquicordConfig
            ];
          in
          {
            home.file."${cfg.configDir}/settings/settings.json".text = builtins.toJSON (
              mkVencordCfg fullConfig
            );
          }
        ))
        # Client Settings
        (mkIf (cfg.discord.settings != { }) {
          home.file."${cfg.discord.configDir}/settings.json".text = builtins.toJSON (
            mkVencordCfg cfg.discord.settings
          );
        })
      ]))
      (mkIf cfg.vesktop.enable (mkMerge [
        # QuickCSS
        (mkIf (isQuickCssUsed cfg.vesktopConfig) {
          home.file."${cfg.vesktop.configDir}/settings/quickCss.css".text = cfg.quickCss;
        })
        # Vencord Settings
        {
          home.file."${cfg.vesktop.configDir}/settings/settings.json".text = builtins.toJSON (
            mkVencordCfg (recursiveUpdateAttrsList [
              cfg.config
              cfg.extraConfig
              cfg.vesktopConfig
            ])
          );
        }
        # Vesktop Client Settings
        (mkIf (cfg.vesktop.settings != { }) {
          home.file."${cfg.vesktop.configDir}/settings.json".text = builtins.toJSON (
            mkVencordCfg cfg.vesktop.settings
          );
        })
        # Vesktop Client State
        (mkIf (cfg.vesktop.state != { }) {
          home.file."${cfg.vesktop.configDir}/state.json".text = builtins.toJSON (
            mkVencordCfg cfg.vesktop.state
          );
        })
        # Vesktop Themes
        (mkIf (cfg.config.themes != { }) {
          home.file = lib.mapAttrs' (
            name: value:
            lib.nameValuePair "${cfg.vesktop.configDir}/themes/${name}.css" {
              text = if builtins.isPath value || lib.isStorePath value then builtins.readFile value else value;
            }
          ) cfg.config.themes;
        })
      ]))
      (mkIf cfg.equibop.enable (mkMerge [
        # QuickCSS
        (mkIf (isQuickCssUsed cfg.equibopConfig) {
          home.file."${cfg.equibop.configDir}/settings/quickCss.css".text = cfg.quickCss;
        })
        # Equicord Settings
        {
          home.file."${cfg.equibop.configDir}/settings/settings.json".text = builtins.toJSON (
            mkVencordCfg (recursiveUpdateAttrsList [
              cfg.config
              cfg.extraConfig
              cfg.equibopConfig
            ])
          );
        }
        # Equibop Client Settings
        (mkIf (cfg.equibop.settings != { }) {
          home.file."${cfg.equibop.configDir}/settings.json".text = builtins.toJSON (
            mkVencordCfg cfg.equibop.settings
          );
        })
        # Equibop Client State
        (mkIf (cfg.equibop.state != { }) {
          home.file."${cfg.equibop.configDir}/state.json".text = builtins.toJSON (
            mkVencordCfg cfg.equibop.state
          );
        })
        # Equibop Themes
        (mkIf (cfg.config.themes != { }) {
          home.file = lib.mapAttrs' (
            name: value:
            lib.nameValuePair "${cfg.equibop.configDir}/themes/${name}.css" {
              text = if builtins.isPath value || lib.isStorePath value then builtins.readFile value else value;
            }
          ) cfg.config.themes;
        })
      ]))
      # Dorion Client Settings
      (mkIf cfg.dorion.enable (mkMerge [
        {
          home.file."${cfg.dorion.configDir}/config.json".text =
            let
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
              dorionConfig = {
                autoupdate = false;
              }
              // (lib.mapAttrs' (name: value: {
                name = toSnakeCase name;
                inherit value;
              }) (builtins.removeAttrs cfg.dorion [ "extraSettings" ]));
            in
            builtins.toJSON (dorionConfig // cfg.dorion.extraSettings);
        }
        {
          home.activation.setupDorionVencordSettings = activationScripts.setupDorionVencordSettings;
        }
      ]))
      # Warnings
      {
        warnings = import ../warnings.nix {
          inherit cfg mkIf lib;
          deprecatedPlugins = collectDeprecatedPlugins cfg.config;
          pluginNameMigrations = pluginNameMigrations;
        };
      }
    ]);
}
