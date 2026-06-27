{
  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    nixpkgs-nixcord.url = "github:NixOS/nixpkgs/nixos-26.05";
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
          revision =
            if builtins.hasAttr "rev" inputs.self && inputs.self.rev != null then
              inputs.self.rev
            else if builtins.hasAttr "dirtyRev" inputs.self && inputs.self.dirtyRev != null then
              inputs.self.dirtyRev
            else
              "main";
          discordAvailable = pkgs.lib.meta.availableOn pkgs.stdenv.hostPlatform pkgs.discord;
          discordPackages = pkgs.lib.optionalAttrs discordAvailable {
            discord = pkgs.callPackage ./pkgs/discord { };
            discord-ptb = pkgs.callPackage ./pkgs/discord { branch = "ptb"; };
            discord-canary = pkgs.callPackage ./pkgs/discord { branch = "canary"; };
            discord-development = pkgs.callPackage ./pkgs/discord { branch = "development"; };
          };
          docsArtifacts = import ./docs {
            pkgs = pkgs;
            lib = pkgs.lib;
            inherit revision;
          };
          docsSystems = [
            "x86_64-linux"
            "aarch64-darwin"
          ];
          docsPackages = pkgs.lib.optionalAttrs (builtins.elem system docsSystems) {
            docs = docsArtifacts.html;
          };
        in
        {
          _module.args.pkgs = pkgs;
          checks = import ./modules/tests { inherit pkgs; };

          packages =
            discordPackages
            // docsPackages
            // {
              vencord = pkgs.callPackage ./pkgs/vencord.nix { };
              vencord-unstable = pkgs.callPackage ./pkgs/vencord.nix { unstable = true; };
              equicord = pkgs.callPackage ./pkgs/equicord.nix { };
              generate = pkgs.callPackage ./pkgs/generate-options.nix { };

              docs-json = docsArtifacts.json;
            };

          apps.generate = {
            type = "app";
            program = pkgs.lib.getExe (
              pkgs.writeShellApplication {
                name = "generate-plugin-options";
                runtimeInputs = [
                  pkgs.nixfmt
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
            meta.description = "Regenerate nixcord plugin option files";
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
