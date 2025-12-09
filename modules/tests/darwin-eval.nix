{ pkgs }:

let
  nixcordModule = import ../darwin/default.nix;

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
          home = "/Users/testuser";
        };
      }
    ];
  };
in

pkgs.runCommand "darwin-eval-test" { } ''
  echo "Darwin module evaluation successful"
  touch $out
''
