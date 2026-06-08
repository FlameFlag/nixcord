{ lib, ... }:
let
  inherit (lib) mkOption types;
in
{
  options.programs.nixcord = {
    vesktopConfig = mkOption {
      type = types.attrsOf types.anything;
      default = { };
      description = "Additional config merged into `programs.nixcord.config` for Vesktop only.";
    };
    equibopConfig = mkOption {
      type = types.attrsOf types.anything;
      default = { };
      description = "Additional config merged into `programs.nixcord.config` for Equibop only.";
    };
    vencordConfig = mkOption {
      type = types.attrsOf types.anything;
      default = { };
      description = "Additional config merged into `programs.nixcord.config` for Vencord (Discord) only.";
    };
    equicordConfig = mkOption {
      type = types.attrsOf types.anything;
      default = { };
      description = "Additional config merged into `programs.nixcord.config` for Equicord (Discord) only.";
    };
    extraConfig = mkOption {
      type = types.attrsOf types.anything;
      default = { };
      description = "Additional config merged into `programs.nixcord.config` for all clients.";
    };
    userPlugins =
      let
        githubRegex = "github:([[:alnum:].-]+)/([[:alnum:]/-]+)/([0-9a-f]{40})";
        coerce =
          value:
          let
            githubMatches = builtins.match githubRegex value;
          in
          if githubMatches != null then
            builtins.fetchGit {
              url = "https://github.com/${builtins.elemAt githubMatches 0}/${builtins.elemAt githubMatches 1}";
              rev = builtins.elemAt githubMatches 2;
            }
          else if lib.hasPrefix "/" value then
            /. + value
          else
            throw "programs.nixcord.userPlugins: '${value}' is not a valid github: URL (github:owner/repo/commitHash) or absolute local path (must start with /)";
      in
      mkOption {
        type = types.attrsOf (types.coercedTo types.str coerce types.path);
        description = ''
          User plugins to fetch and install. Any required JSON config must be enabled in `extraConfig`.

          Accepts:
          - GitHub URLs: `github:owner/repo/commitHash`
          - Absolute local paths: `/path/to/plugin` (requires `--impure` with flakes)
          - Nix path literals: `./relative/path` or `/absolute/path`
          - Packages/derivations
        '';
        default = { };
        example = {
          someCoolPlugin = "github:someUser/someCoolPlugin/someHashHere";
          localPlugin = "/home/user/projects/myPlugin";
        };
      };
    parseRules = {
      upperNames = mkOption {
        type = types.listOf types.str;
        description = "Option names that should be converted to UPPER_SNAKE_CASE in generated JSON.";
        default = [ ];
      };
      lowerPluginTitles = mkOption {
        type = types.listOf types.str;
        description = "Plugin names that should remain lowercase in generated JSON.";
        default = [ ];
        example = [ "petpet" ];
      };
      pluginRenames = mkOption {
        type = types.attrsOf types.str;
        description = "Plugin option names to rename while generating JSON.";
        default = { };
      };
      settingRenames = mkOption {
        type = types.attrsOf (types.attrsOf types.str);
        description = "Setting names to rename while generating JSON.";
        default = { };
      };
    };
  };
}
