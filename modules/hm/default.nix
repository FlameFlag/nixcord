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
    ;
in
{
  imports = [
    ../options
    ../plugins/migrations.nix
    ../warnings.nix
  ];

  config = mkIf config.programs.nixcord.enable (
    let
      inherit (import ../lib/mkCommonConfig.nix { inherit config lib pkgs; })
        cfg
        mkVencordCfg
        mkFinalPackages
        vencordFullConfig
        equicordFullConfig
        vesktopFullConfig
        equibopFullConfig
        vencord
        equicord
        isQuickCssUsed
        mkDorionConfigAttrs
        mkConfigDirs
        legcordSettingsFile
        legcordVencordWeb
        legcordEquicordWeb
        ;

      install = lib.getExe' pkgs.coreutils "install";

      mkWritableSettingsActivation =
        text: dest:
        lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          dest=${lib.escapeShellArg dest}
          if [ -L "$dest" ]; then
            rm "$dest"
          elif [ -e "$dest" ]; then
            chmod u+w "$dest" 2>/dev/null || true
          fi
          ${install} -Dm644 /dev/null "$dest"
          cat > "$dest" <<'EOF'
          ${text}
          EOF
        '';

      activationScripts = import ../lib/activation.nix {
        inherit
          lib
          pkgs
          cfg
          mkVencordCfg
          ;
        wrapScript = script: lib.hm.dag.entryAfter [ "writeBoundary" ] script;
      };

    in
    mkMerge ([
      {
        programs.nixcord = {
          user = lib.mkDefault config.home.username;
        }
        // mkConfigDirs {
          inherit cfg;
          basePath =
            if pkgs.stdenvNoCC.isLinux then
              config.xdg.configHome
            else
              "${config.home.homeDirectory}/Library/Application Support";
        };
      }
      {
        programs.nixcord.finalPackage = mkFinalPackages {
          inherit cfg;
          inherit vencord equicord;
        };

        home.packages = mkMerge [
          (mkIf (cfg.discord.enable && cfg.discord.installPackage) [ cfg.finalPackage.discord ])
          (mkIf (cfg.vesktop.enable && cfg.vesktop.installPackage) [ cfg.finalPackage.vesktop ])
          (mkIf (cfg.equibop.enable && cfg.finalPackage.equibop != null && cfg.equibop.installPackage) [
            cfg.finalPackage.equibop
          ])
          (mkIf (cfg.dorion.enable && cfg.dorion.installPackage) [ cfg.finalPackage.dorion ])
          (mkIf (cfg.legcord.enable && cfg.legcord.installPackage) [ cfg.finalPackage.legcord ])
        ];
      }
      (mkIf cfg.discord.enable (mkMerge [
        {
          home.activation.disableDiscordUpdates = activationScripts.disableDiscordUpdates;
          home.activation.fixDiscordModules = activationScripts.fixDiscordModules;
        }
        (mkIf (isQuickCssUsed cfg.vencordConfig || isQuickCssUsed cfg.equicordConfig) {
          home.file."${cfg.configDir}/settings/quickCss.css".text = cfg.quickCss;
        })
        (mkIf cfg.discord.vencord.enable {
          home.activation.nixcord-vencord-settings = mkWritableSettingsActivation (builtins.toJSON (mkVencordCfg vencordFullConfig)) "${cfg.configDir}/settings/settings.json";
        })
        (mkIf cfg.discord.equicord.enable {
          home.activation.nixcord-equicord-settings = mkWritableSettingsActivation (builtins.toJSON (mkVencordCfg equicordFullConfig)) "${cfg.configDir}/settings/settings.json";
        })
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
            mkVencordCfg vesktopFullConfig
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
            mkVencordCfg equibopFullConfig
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
          home.file."${cfg.dorion.configDir}/config.json".text = builtins.toJSON (mkDorionConfigAttrs {
            inherit cfg;
          });
        }
        {
          home.activation.setupDorionVencordSettings = activationScripts.setupDorionVencordSettings;
        }
      ]))
      (mkIf cfg.legcord.enable (mkMerge [
        (mkIf (legcordSettingsFile != null) {
          # Legcord needs a writable settings.json (it writes modCache, window state, etc.
          # at runtime), so we copy instead of symlinking via home.file.
          home.activation.nixcord-legcord-settings = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
            install -Dm644 ${legcordSettingsFile} "${cfg.legcord.configDir}/storage/settings.json"
          '';
        })
        (mkIf cfg.legcord.vencord.enable {
          home.file."${cfg.legcord.configDir}/vencord.js".source = "${legcordVencordWeb}/browser.js";
          home.file."${cfg.legcord.configDir}/vencord.css".source = "${legcordVencordWeb}/browser.css";
        })
        (mkIf cfg.legcord.equicord.enable {
          home.file."${cfg.legcord.configDir}/equicord.js".source = "${legcordEquicordWeb}/browser.js";
          home.file."${cfg.legcord.configDir}/equicord.css".source = "${legcordEquicordWeb}/browser.css";
        })
      ]))
    ])
  );
}
