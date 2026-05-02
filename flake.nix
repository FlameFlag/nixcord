{
  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixpkgs-nixcord.url = "github:NixOS/nixpkgs/nixos-25.11";
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
          pkgs = import inputs.nixpkgs-nixcord {
            inherit system;
            config = {
              allowUnfree = true;
              permittedInsecurePackages = [ "openssl-1.1.1w" ];
            };
          };
        in
        {
          _module.args.pkgs = pkgs;
          checks =
            let
              hm-eval = import ./modules/tests/hm-eval.nix { inherit pkgs; };
              nixos-eval = import ./modules/tests/nixos-eval.nix { inherit pkgs; };
              darwin-eval = import ./modules/tests/darwin-eval.nix { inherit pkgs; };
              config-output = import ./modules/tests/config-output.nix { inherit pkgs; };
              assertions = import ./modules/tests/assertions.nix { inherit pkgs; };
            in
            {
              inherit hm-eval nixos-eval config-output assertions;
            }
            // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
              inherit darwin-eval;
            };

          packages = {
            discord = pkgs.callPackage ./pkgs/discord.nix { };
            discord-ptb = pkgs.callPackage ./pkgs/discord.nix { branch = "ptb"; };
            discord-canary = pkgs.callPackage ./pkgs/discord.nix { branch = "canary"; };
            discord-development = pkgs.callPackage ./pkgs/discord.nix { branch = "development"; };
            vencord = pkgs.callPackage ./pkgs/vencord.nix { };
            vencord-unstable = pkgs.callPackage ./pkgs/vencord.nix { unstable = true; };
            equicord = pkgs.callPackage ./pkgs/equicord.nix { };
            generate = pkgs.callPackage ./pkgs/generate-options.nix {
              vencord = pkgs.callPackage ./pkgs/vencord.nix { };
              equicord = pkgs.callPackage ./pkgs/equicord.nix { };
            };

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
                  cp ./result/deprecated.nix ./modules/plugins/ 2>/dev/null || true
                  chmod -R u+w ./modules/plugins
                  nixfmt ./modules/plugins/*.nix
                '';
              }
            );
          };
        };

      flake = {
        homeModules.default =
          { pkgs, ... }:
          {
            imports = [ ./modules/hm ];
            _module.args.nixcordPkgs = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
          };
        homeModules.nixcord = inputs.self.homeModules.default;

        nixosModules.default =
          { pkgs, ... }:
          {
            imports = [ ./modules/nixos ];
            _module.args.nixcordPkgs = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
          };
        nixosModules.nixcord = inputs.self.nixosModules.default;

        darwinModules.default =
          { pkgs, ... }:
          {
            imports = [ ./modules/darwin ];
            _module.args.nixcordPkgs = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
          };
        darwinModules.nixcord = inputs.self.darwinModules.default;
      };
    };
}
