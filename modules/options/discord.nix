{
  lib,
  pkgs,
  nixcordPkgs ? { },
  ...
}:
let
  inherit (lib) mkEnableOption mkOption types;
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
      default = pkgs.callPackage ../../pkgs/discord.nix (
        lib.optionalAttrs (
          pkgs.stdenvNoCC.isLinux && builtins.fromJSON (lib.versions.major lib.version) < 25
        ) { libgbm = pkgs.mesa; }
      );
      defaultText = lib.literalExpression "pkgs.callPackage ../../pkgs/discord.nix { }";
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
        default = nixcordPkgs.vencord or (pkgs.callPackage ../../pkgs/vencord.nix { unstable = false; });
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
        default = nixcordPkgs.equicord or (pkgs.callPackage ../../pkgs/equicord.nix { });
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
    autoscroll.enable = mkEnableOption "middle-click autoscrolling for Discord";
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
}
