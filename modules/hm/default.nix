{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib)
    mkIf
    mkMerge
    types
    ;

  inherit (pkgs.callPackage ../lib/shared.nix { inherit lib; })
    mergeAttrsList
    applyPostPatch
    mkIsQuickCssUsed
    mkPluginKit
    ;

  dop = with types; coercedTo package (a: a.outPath) pathInStore;

in
{
  options.programs.nixcord = import ../options.nix {
    inherit
      lib
      pkgs
      dop
      applyPostPatch
      ;
  };

  config = mkIf config.programs.nixcord.enable (
    let
      cfg = config.programs.nixcord;

      parseRules = cfg.parseRules;

      inherit (pkgs.callPackage ../lib/core.nix { inherit lib parseRules; })
        mkVencordCfg
        mkFinalPackages
        ;

      pluginKit = mkPluginKit { inherit cfg; };

      inherit (pluginKit)
        pluginNameMigrations
        collectDeprecatedPlugins
        mkFullConfig
        ;

      activationScripts = import ./lib/activation.nix {
        inherit
          lib
          pkgs
          cfg
          config
          mkVencordCfg
          ;
        wrapScript = script: lib.hm.dag.entryAfter [ "writeBoundary" ] script;
      };

      vencord = applyPostPatch {
        inherit cfg;
        pkg = cfg.discord.vencord.package;
      };
      equicord = applyPostPatch {
        inherit cfg;
        pkg = cfg.discord.equicord.package;
      };

      isQuickCssUsed = mkIsQuickCssUsed { inherit cfg; };

      allPlugins =
        cfg.config.plugin
        // cfg.extraConfig.plugin
        // cfg.vencordConfig.plugin
        // cfg.equicordConfig.plugin
        // cfg.equibopConfig.plugins;

      deprecatedPlugins = collectDeprecatedPlugins { plugins = allPlugins; };
    in
    mkMerge (
      [
        {
          programs.nixcord = {
            discord.configDir = lib.mkDefault (
              let
                basePath = if pkgs.stdenvNoCC.isLinux then config.xdg.configHome else "${config.home.homeDirectory}/Library/Application Support";
                branchDirName =
                  {
                    stable = "discord";
                    ptb = "discordptb";
                    canary = "discordcanary";
                    development = "discorddevelopment";
                  }
                  .${cfg.discord.branch} or "discord";
              in
              "${basePath}/${branchDirName}"
            );
            configDir = lib.mkDefault (
              let
                basePath = if pkgs.stdenvNoCC.isLinux then config.xdg.configHome else "${config.home.homeDirectory}/Library/Application Support";
                dirName = if cfg.discord.equicord.enable then "Equicord" else "Vencord";
              in
              "${basePath}/${dirName}"
            );
            vesktop.configDir = lib.mkDefault (
              if pkgs.stdenvNoCC.isLinux then
                "${config.xdg.configHome}/vesktop"
              else
                "${config.home.homeDirectory}/Library/Application Support/vesktop"
            );
            equibop.configDir = lib.mkDefault (
              if pkgs.stdenvNoCC.isLinux then
                "${config.xdg.configHome}/equibop"
              else
                "${config.home.homeDirectory}/Library/Application Support/equibop"
            );
            dorion.configDir = lib.mkDefault (
              if pkgs.stdenvNoCC.isLinux then
                "${config.xdg.configHome}/dorion"
              else
                "${config.home.homeDirectory}/Library/Application Support/dorion"
            );
          };
        }
        {
          programs.nixcord.finalPackage = mkFinalPackages {
            inherit cfg;
            inherit vencord equicord;
          };

          home.packages = mkMerge [
            (mkIf cfg.discord.enable [ cfg.finalPackage.discord ])
            (mkIf cfg.vesktop.enable [ cfg.finalPackage.vesktop ])
            (mkIf (cfg.equibop.enable && cfg.finalPackage.equibop != null) [ cfg.finalPackage.equibop ])
            (mkIf cfg.dorion.enable [ cfg.finalPackage.dorion ])
          ];
        }
      ]
        (mkIf cfg.discord.enable (mkMerge [
          {
            home.activation.disableDiscordUpdates = activationScripts.disableDiscordUpdates;
            home.activation.fixDiscordModules = activationScripts.fixDiscordModules;
          }
          (mkIf (isQuickCssUsed cfg.vencordConfig || isQuickCssUsed cfg.equicordConfig) {
            home.file."${cfg.configDir}/settings/quickCss.css".text = cfg.quickCss;
          })
          (mkIf cfg.discord.vencord.enable (
            let
              fullConfig = mkFullConfig {
                baseConfig = cfg.config;
                extraConfig = cfg.extraConfig;
                clientConfig = cfg.vencordConfig;
              };
            in
            {
              home.file."${cfg.configDir}/settings/settings.json".text = builtins.toJSON (
                mkVencordCfg fullConfig
              );
            }
          ))
          (mkIf cfg.discord.equicord.enable (
            let
              fullConfig = mkFullConfig {
                baseConfig = cfg.config;
                extraConfig = cfg.extraConfig;
                clientConfig = cfg.equicordConfig;
              };
            in
            {
              home.file."${cfg.configDir}/settings/settings.json".text = builtins.toJSON (
                mkVencordCfg fullConfig
              );
            }
          ))
          (mkIf (cfg.discord.settings != { }) {
            home.file."${cfg.discord.configDir}/settings.json".text = builtins.toJSON (
              mkVencordCfg cfg.discord.settings
            );
          })
        ]))
        (mkIf cfg.vesktop.enable (mkMerge [
          (mkIf (isQuickCssUsed cfg.vesktopConfig) {
            home.file."${cfg.vesktop.configDir}/settings/quickCss.css".text = cfg.quickCss;
          })
          {
            home.file."${cfg.vesktop.configDir}/settings/settings.json".text = builtins.toJSON (
              mkVencordCfg (mergeAttrsList [
                cfg.config
                cfg.extraConfig
                cfg.vesktopConfig
              ])
            );
          }
          (mkIf (cfg.vesktop.settings != { }) {
            home.file."${cfg.vesktop.configDir}/settings.json".text = builtins.toJSON (
              mkVencordCfg cfg.vesktop.settings
            );
          })
          (mkIf (cfg.vesktop.state != { }) {
            home.file."${cfg.vesktop.configDir}/state.json".text = builtins.toJSON (
              mkVencordCfg cfg.vesktop.state
            );
          })
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
          (mkIf (isQuickCssUsed cfg.equibopConfig) {
            home.file."${cfg.equibop.configDir}/settings/quickCss.css".text = cfg.quickCss;
          })
          {
            home.file."${cfg.equibop.configDir}/settings/settings.json".text = builtins.toJSON (
              mkVencordCfg (mergeAttrsList [
                cfg.config
                cfg.extraConfig
                cfg.equibopConfig
              ])
            );
          }
          (mkIf (cfg.equibop.settings != { }) {
            home.file."${cfg.equibop.configDir}/settings.json".text = builtins.toJSON (
              mkVencordCfg cfg.equibop.settings
            );
          })
          (mkIf (cfg.equibop.state != { }) {
            home.file."${cfg.equibop.configDir}/state.json".text = builtins.toJSON (
              mkVencordCfg cfg.equibop.state
            );
          })
          (mkIf (cfg.config.themes != { }) {
            home.file = lib.mapAttrs' (
              name: value:
              lib.nameValuePair "${cfg.equibop.configDir}/themes/${name}.css" {
                text = if builtins.isPath value || lib.isStorePath value then builtins.readFile value else value;
              }
            ) cfg.config.themes;
          })
        ]))
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
        {
          warnings = import ../../warnings.nix {
            inherit
              cfg
              mkIf
              lib
              deprecatedPlugins
              pluginNameMigrations
              ;
          };
        }
      ]
    )
  );
}
