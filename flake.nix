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
            };
          };
        in
        {
          _module.args.pkgs = pkgs;
          checks = import ./modules/tests { inherit pkgs; };

          packages = {
            discord = pkgs.callPackage ./pkgs/discord { };
            discord-ptb = pkgs.callPackage ./pkgs/discord { branch = "ptb"; };
            discord-canary = pkgs.callPackage ./pkgs/discord { branch = "canary"; };
            discord-development = pkgs.callPackage ./pkgs/discord { branch = "development"; };
            vencord = pkgs.callPackage ./pkgs/vencord.nix { };
            vencord-unstable = pkgs.callPackage ./pkgs/vencord.nix { unstable = true; };
            equicord = pkgs.callPackage ./pkgs/equicord.nix { };
            generate = pkgs.callPackage ./pkgs/generate-options.nix { };

            docs =
              (import ./docs {
                pkgs = pkgs;
                lib = pkgs.lib;
                revision = inputs.self.rev or inputs.self.dirtyRev or "main";
              }).html;
            docs-json =
              (import ./docs {
                pkgs = pkgs;
                lib = pkgs.lib;
                revision = inputs.self.rev or inputs.self.dirtyRev or "main";
              }).json;
          };

          apps.generate = {
            type = "app";
            program = pkgs.lib.getExe (
              pkgs.writeShellApplication {
                name = "generate-plugin-options";
                runtimeInputs = [
                  pkgs.nixfmt-rfc-style
                ];
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
