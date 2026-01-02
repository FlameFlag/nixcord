{
  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-compat.url = "https://flakehub.com/f/edolstra/flake-compat/1.tar.gz";
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      perSystem =
        { system, inputs', ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
        in
        {
          _module.args.pkgs = pkgs;
          checks =
            let
              hm-eval = import ./modules/tests/hm-eval.nix { inherit pkgs; };
              nixos-eval = import ./modules/tests/nixos-eval.nix { inherit pkgs; };
              darwin-eval = import ./modules/tests/darwin-eval.nix { inherit pkgs; };
            in
            {
              inherit hm-eval nixos-eval;
            }
            // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
              inherit darwin-eval;
            };

          packages = {
            discord = pkgs.callPackage ./pkgs/discord.nix { };
            discord-ptb = pkgs.callPackage ./pkgs/discord.nix { branch = "ptb"; };
            discord-canary = pkgs.callPackage ./pkgs/discord.nix { branch = "canary"; };
            discord-development = pkgs.callPackage ./pkgs/discord.nix { branch = "development"; };
            dorion = pkgs.callPackage ./pkgs/dorion.nix { };
            vencord = pkgs.callPackage ./pkgs/vencord.nix { };
            vencord-unstable = pkgs.callPackage ./pkgs/vencord.nix { unstable = true; };
            equicord = pkgs.callPackage ./pkgs/equicord.nix { };

            docs-html =
              (import ./docs {
                pkgs = pkgs;
                lib = pkgs.lib;
              }).html;
            docs-json =
              (import ./docs {
                pkgs = pkgs;
                lib = pkgs.lib;
              }).json;
          };

          apps.generate = {
            type = "app";
            program = pkgs.lib.getExe (
              pkgs.writeShellApplication {
                name = "generate-plugin-options";
                runtimeInputs = [ pkgs.nixfmt-rfc-style ];
                text = ''
                  nix build .#generate --out-link ./result
                  mkdir -p ./modules/plugins
                  cp -R ./result/plugins/. ./modules/plugins/
                  chmod -R u+w ./modules/plugins
                  nixfmt ./modules/plugins/*.nix
                '';
              }
            );
          };
        };

      flake = {
        darwinModules.default = import ./modules/darwin;
        darwinModules.nixcord = inputs.self.darwinModules.default;

        homeModules.default = import ./modules/hm;
        homeModules.nixcord = inputs.self.homeModules.default;

        nixosModules.default = import ./modules/nixos;
        nixosModules.nixcord = inputs.self.nixosModules.default;
      };
    };
}
