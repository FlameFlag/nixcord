{ pkgs }:

let
  nixcordModule = import ../nixos/default.nix;

  testEval = pkgs.lib.evalModules {
    modules = [
      nixcordModule
      {
        programs.nixcord = {
          enable = true;
          user = "testuser";
          config.plugins.hideDisabledEmojis.enable = true;
        };

        users.users.testuser = {
          name = "testuser";
          home = "/home/testuser";
          isNormalUser = true;
        };

        system.stateVersion = "25.11";
      }
    ];
  };
in

pkgs.runCommand "nixos-eval-test" { } ''
  echo "NixOS module evaluation successful"
  touch $out
''
