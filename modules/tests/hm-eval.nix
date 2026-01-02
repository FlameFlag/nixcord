{ pkgs }:

let
  nixcordModule = import ../hm/default.nix;

  baseHMConfig =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      options = {
        home.homeDirectory = lib.mkOption {
          type = lib.types.path;
          default = "/home/testuser";
          description = "User's home directory";
        };
        xdg.configHome = lib.mkOption {
          type = lib.types.path;
          default = "/home/testuser/.config";
          description = "XDG config directory";
        };
      };
      config = {
        home.homeDirectory = lib.mkDefault "/home/testuser";
        xdg.configHome = lib.mkDefault "/home/testuser/.config";
      };
    };

  testEval = pkgs.lib.evalModules {
    modules = [
      baseHMConfig
      nixcordModule
      {
        programs.nixcord = {
          enable = true;
          config.plugins.hideDisabledEmojis.enable = true;
        };
      }
    ];
    specialArgs = { inherit pkgs; };
  };
in

pkgs.runCommand "hm-eval-test" { } ''
  echo "Home Manager module evaluation successful"
  touch $out
''
