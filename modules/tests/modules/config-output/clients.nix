{ testLib }:

let
  common = import ./common.nix { inherit testLib; };
  inherit (common)
    baseConfig
    vesktopBaseConfig
    recursiveUpdate
    ;
  inherit (testLib) lib pkgs;
  stubDiscordPackage = pkgs.runCommand "nixcord-discord-stub" { } "mkdir $out" // {
    override =
      args:
      pkgs.runCommand "nixcord-discord-final-stub" { } "mkdir $out"
      // {
        passthru.nixcordOverrideArgs = args;
      };
  };
  stubEquicordPackage = pkgs.runCommand "nixcord-equicord-stub" { } "mkdir -p $out/equibop" // {
    overrideAttrs =
      f:
      let
        attrs = f {
          postPatch = "";
          postInstall = "";
        };
      in
      pkgs.runCommand "nixcord-equicord-final-stub" { } "mkdir -p $out/equibop" // attrs;
  };
  stubEquibopPackage = lib.makeOverridable (
    {
      withMiddleClickScroll ? false,
    }:
    pkgs.runCommand "nixcord-equibop-stub" { } "mkdir $out"
    // {
      postPatch = "";
      postFixup = "";
    }
  ) { };
in
{
  "configDir defaults to Equicord when equicord is enabled" =
    let
      config = testLib.eval.hm {
        enable = true;
        discord.vencord.enable = false;
        discord.equicord.enable = true;
      };
    in
    assert lib.hasSuffix "Equicord" (toString config.programs.nixcord.configDir);
    true;

  "configDir defaults to Vencord when vencord is enabled" =
    let
      config = testLib.eval.hm {
        enable = true;
        discord.vencord.enable = true;
      };
    in
    assert lib.hasSuffix "Vencord" (toString config.programs.nixcord.configDir);
    true;

  "discord settings are generated when non-empty" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          discord.settings = {
            BACKGROUND_COLOR = "#2c2d32";
            USE_NEW_UPDATER = true;
          };
        }
      );
      settingsJson = testLib.output.homeFileJSON config "/home/testuser/.config/discord/settings.json";
    in
    assert settingsJson.BACKGROUND_COLOR == "#2c2d32";
    assert settingsJson.SKIP_HOST_UPDATE == true;
    assert settingsJson.SKIP_MODULE_UPDATE == true;
    assert settingsJson.USE_NEW_UPDATER == false;
    true;

  "discord autoscroll shim appends commandLineArgs" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          discord.package = stubDiscordPackage;
          discord.autoscroll.enable = true;
          discord.commandLineArgs = [ "--ozone-platform-hint=auto" ];
        }
      );
      overrideArgs = config.programs.nixcord.finalPackage.discord.passthru.nixcordOverrideArgs;
    in
    assert
      overrideArgs.commandLineArgs == [
        "--ozone-platform-hint=auto"
        "--enable-blink-features=MiddleClickAutoscroll"
      ];
    true;

  "discord commandLineArgs are accepted" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          discord.commandLineArgs = [
            "--ozone-platform-hint=auto"
            "--enable-wayland-ime"
          ];
        }
      );
    in
    assert
      config.programs.nixcord.discord.commandLineArgs == [
        "--ozone-platform-hint=auto"
        "--enable-wayland-ime"
      ];
    true;

  "vesktop settings are generated when vesktop is enabled" =
    let
      config = testLib.eval.hm (
        recursiveUpdate vesktopBaseConfig {
          config.plugins.alwaysAnimate.enable = true;
        }
      );
      settingsJson = testLib.output.homeFileJSON config "/home/testuser/.config/vesktop/settings/settings.json";
    in
    assert settingsJson.plugins.AlwaysAnimate.enabled == true;
    true;

  "equibop uses patched system Equicord by default" =
    let
      config = testLib.eval.hm {
        enable = true;
        discord.enable = false;
        discord.equicord.package = stubEquicordPackage;
        equibop = {
          enable = true;
          package = stubEquibopPackage;
        };
      };
      equibop = config.programs.nixcord.finalPackage.equibop;
      equicord = config._nixcordTest.common.packages.equicord;
      postPatch = builtins.unsafeDiscardStringContext equibop.postPatch;
      equicordAsar = builtins.unsafeDiscardStringContext "${equicord}/equibop.asar";
    in
    assert lib.hasInfix "src/main/vencordDir.ts src/main/constants.ts" postPatch;
    assert lib.hasInfix "could not find Equibop Equicord asar path to patch" postPatch;
    assert lib.hasInfix equicordAsar postPatch;
    true;

  "equibop can keep bundled Equicord" =
    let
      config = testLib.eval.hm {
        enable = true;
        discord.enable = false;
        equibop = {
          enable = true;
          package = stubEquibopPackage;
          useSystemEquicord = false;
        };
      };
      equibop = config.programs.nixcord.finalPackage.equibop;
      postPatch = builtins.unsafeDiscardStringContext equibop.postPatch;
    in
    assert !(lib.hasInfix "equicordPatchTarget" postPatch);
    true;
}
