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
    mkCopyCommands
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

      isQuickCssUsed = mkIsQuickCssUsed { inherit cfg; };

      pluginKit = mkPluginKit { inherit cfg; };

      inherit (pluginKit)
        pluginNameMigrations
        collectDeprecatedPlugins
        mkFullConfig
        ;

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

      vesktopFullConfig = mergeAttrsList [
        cfg.config
        cfg.extraConfig
        cfg.vesktopConfig
      ];

      equibopFullConfig = mergeAttrsList [
        cfg.config
        cfg.extraConfig
        cfg.equibopConfig
      ];

      quickCssFile = pkgs.writeText "nixcord-quickcss.css" cfg.quickCss;

      vencordSettingsFile = pkgs.writeText "nixcord-settings.json" (
        builtins.toJSON (mkVencordCfg vencordFullConfig)
      );
      equicordSettingsFile = pkgs.writeText "nixcord-equicord-settings.json" (
        builtins.toJSON (mkVencordCfg equicordFullConfig)
      );

      discordSettingsFile =
        if cfg.discord.settings != { } then
          pkgs.writeText "nixcord-discord-settings.json" (builtins.toJSON (mkVencordCfg cfg.discord.settings))
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

      mkThemeFile =
        name: value:
        if builtins.isPath value || lib.isStorePath value then
          value
        else
          pkgs.writeText "nixcord-theme-${name}.css" value;

      vesktopThemes = lib.mapAttrs mkThemeFile cfg.config.themes;

      dorionConfigFile =
        if cfg.dorion.enable then
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
          pkgs.writeText "nixcord-dorion-config.json" (
            builtins.toJSON (dorionConfig // cfg.dorion.extraSettings)
          )
        else
          null;

      homeDir = "/Users/${cfg.user}";

      activationScripts = import ../lib/activation.nix {
        inherit
          lib
          pkgs
          cfg
          config
          mkVencordCfg
          ;
        wrapScript = script: ''
          ${script}
          ${lib.concatMapStringsSep "\n"
            (dir: ''
              if [ -d "${dir}" ]; then
                chown -R ${lib.escapeShellArg cfg.user}:${lib.escapeShellArg null} "${dir}" 2>/dev/null || true
              fi
            '')
            [
              "${homeDir}/Library/Application Support/Vencord"
              "${homeDir}/Library/Application Support/discord"
              "${homeDir}/Library/Application Support/discordptb"
              "${homeDir}/Library/Application Support/discordcanary"
              "${homeDir}/Library/Application Support/discorddevelopment"
              "${homeDir}/Library/Application Support/vesktop"
              "${homeDir}/Library/Application Support/equibop"
              "${homeDir}/.config/dorion"
            ]
          }
        '';
      };

      writeFilesScript =
        let
          install = lib.getExe' pkgs.coreutils "install";
          idBin = lib.getExe' pkgs.coreutils "id";

          fileCommands = mkCopyCommands {
            inherit
              lib
              cfg
              quickCssFile
              vencordSettingsFile
              equicordSettingsFile
              discordSettingsFile
              vesktopSettingsFile
              vesktopClientSettingsFile
              vesktopStateFile
              vesktopThemes
              equibopSettingsFile
              equibopClientSettingsFile
              equibopStateFile
              dorionConfigFile
              isQuickCssUsed
              ;
          };
        in
        ''
          set -euo pipefail

          target_user=${lib.escapeShellArg cfg.user}
          target_group_default=${lib.escapeShellArg null}
          target_group="$target_group_default"
          if [ -z "$target_group" ]; then
            target_group="$(${idBin} -gn "$target_user")"
          fi

          copy_file() {
            local src="$1"
            local dest="$2"
            local mode="$3"
            ${install} -D -m "$mode" -o "$target_user" -g "$target_group" "$src" "$dest"
          }

          ${fileCommands}
        '';
    in
    mkMerge ([
      {
        programs.nixcord = {
          discord.configDir = lib.mkDefault (
            let
              basePath = "${homeDir}/Library/Application Support";
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
              basePath = "${homeDir}/Library/Application Support";
              dirName = if cfg.discord.equicord.enable then "Equicord" else "Vencord";
            in
            "${basePath}/${dirName}"
          );
          vesktop.configDir = lib.mkDefault "${homeDir}/Library/Application Support/vesktop";
          equibop.configDir = lib.mkDefault "${homeDir}/Library/Application Support/equibop";
          dorion.configDir = lib.mkDefault "${homeDir}/.config/dorion";
        };
      }
      {
        programs.nixcord.finalPackage = mkFinalPackages {
          inherit cfg;
          vencord = applyPostPatch {
            inherit cfg;
            pkg = cfg.discord.vencord.package;
          };
          equicord = applyPostPatch {
            inherit cfg;
            pkg = cfg.discord.equicord.package;
          };
        };

        environment.systemPackages = mkMerge [
          (mkIf cfg.discord.enable [ cfg.finalPackage.discord ])
          (mkIf cfg.vesktop.enable [ cfg.finalPackage.vesktop ])
          (mkIf (cfg.equibop.enable && cfg.finalPackage.equibop != null) [ cfg.finalPackage.equibop ])
          (mkIf cfg.dorion.enable [ cfg.finalPackage.dorion ])
        ];
      }
      (mkIf cfg.discord.enable {
        system.activationScripts.nixcord-disableDiscordUpdates.text =
          activationScripts.disableDiscordUpdates;
        system.activationScripts.nixcord-fixDiscordModules.text = activationScripts.fixDiscordModules;
      })
      (mkIf cfg.dorion.enable {
        system.activationScripts.nixcord-setupDorionVencordSettings.text =
          activationScripts.setupDorionVencordSettings;
      })
      (mkIf (cfg.discord.enable || cfg.vesktop.enable || cfg.equibop.enable || cfg.dorion.enable) {
        system.activationScripts.nixcord-writeFiles.text = writeFilesScript;
      })
      {
        warnings = import ../../warnings.nix {
          inherit
            cfg
            mkIf
            lib
            pluginNameMigrations
            ;
          deprecatedPlugins = collectDeprecatedPlugins cfg.config;
        };
      }
    ])
  );
}
