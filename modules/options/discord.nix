{
  config,
  lib,
  pkgs,
  nixcordPkgs ? { },
  ...
}:
let
  inherit (lib) mkDefault mkEnableOption mkOption types;
  vencordPackage = pkgs.callPackage ../../pkgs/vencord.nix { unstable = false; };
  equicordPackage = pkgs.callPackage ../../pkgs/equicord.nix { };
in
{
  options.programs.nixcord.discord = {
    enable = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to enable Discord. Disable to only install Vesktop.";
      example = false;
    };
    installPackage = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to install the final Discord package.";
    };
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ../../pkgs/discord (
        lib.optionalAttrs (
          pkgs.stdenvNoCC.isLinux && builtins.fromJSON (lib.versions.major lib.version) < 25
        ) { libgbm = pkgs.mesa; }
      );
      defaultText = lib.literalExpression "pkgs.callPackage ../../pkgs/discord { }";
      description = "The Discord package to use.";
    };
    branch = mkOption {
      type = types.enum [
        "stable"
        "ptb"
        "canary"
        "development"
      ];
      default = "stable";
      description = "The Discord branch to use.";
      example = "canary";
    };
    configDir = mkOption {
      type = types.path;
      description = "Config directory for Discord.";
    };
    vencord = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Whether to enable Vencord for Discord (non-Vesktop).";
      };
      package = mkOption {
        type = types.package;
        default = nixcordPkgs.vencord or vencordPackage;
        defaultText = lib.literalExpression "pkgs.callPackage ../../pkgs/vencord.nix { unstable = false; }";
        description = "The Vencord package to use.";
      };
      unstable = mkOption {
        type = types.bool;
        default = false;
        description = "Whether to use the unstable Vencord build from the master branch.";
      };
    };
    equicord = {
      enable = mkEnableOption "Equicord (alternative to Vencord)";
      package = mkOption {
        type = types.package;
        default = nixcordPkgs.equicord or equicordPackage;
        defaultText = lib.literalExpression "pkgs.callPackage ../../pkgs/equicord.nix { }";
        description = "The Equicord package to use.";
      };
    };
    openASAR.enable = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to enable OpenASAR for Discord (non-Vesktop).";
    };
    krisp.enable = mkEnableOption "Krisp noise cancellation";
    # TODO: Remove programs.nixcord.discord.autoscroll.enable after the
    # deprecation window; use programs.nixcord.discord.commandLineArgs instead.
    autoscroll.enable = mkOption {
      type = types.bool;
      default = false;
      visible = false;
      description = "Deprecated shim for adding the MiddleClickAutoscroll command line argument.";
    };
    commandLineArgs = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Additional command line arguments to pass to Discord.";
      example = [
        "--enable-features=VaapiVideoDecoder,MiddleClickAutoscroll"
        "--ozone-platform-hint=auto"
        "--enable-wayland-ime"
      ];
    };
    settings = mkOption {
      type = types.attrs;
      default = { };
      description = "Settings to be placed in Discord's settings.json. Set atomically; the entire attrset replaces any previous definition.";
      example = {
        SKIP_HOST_UPDATE = true;
        USE_NEW_UPDATER = false;
      };
    };
  };

  config.programs.nixcord.discord.vencord.enable = mkDefault (
    !config.programs.nixcord.discord.equicord.enable
  );
}
