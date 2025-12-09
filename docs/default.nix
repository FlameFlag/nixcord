# Credit to: https://github.com/nix-community/plasma-manager/blob/b7697abe89967839b273a863a3805345ea54ab56/docs/default.nix#L55
{ pkgs, lib, ... }:
let
  inherit (lib) mkDefault;

  dontCheckModules = {
    _module.check = false;
  };

  # Minimal Home Manager configuration for generating docs
  baseHMConfig =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      visible = false;
    in
    {
      options = {
        home.homeDirectory = lib.mkOption {
          inherit visible;
          type = lib.types.path;
          default = "/home/user";
          description = "User's home directory";
        };
        xdg.configHome = lib.mkOption {
          inherit visible;
          type = lib.types.path;
          default = "/home/user/.config";
          description = "XDG config directory";
        };
      };
      config = {
        home.homeDirectory = mkDefault "/home/user";
        xdg.configHome = mkDefault "/home/user/.config";
      };
    };

  modules = [
    baseHMConfig
    # Define options directly with mock config
    (
      {
        config,
        lib,
        pkgs,
        ...
      }:
      {
        options.programs.nixcord = (
          import ../modules/options.nix {
            inherit lib pkgs;
            dop = with lib.types; coercedTo package (a: a.outPath) pathInStore;
          }
        );
      }
    )
    dontCheckModules
  ];

  githubDeclaration = user: repo: branch: subpath: {
    url = "https://github.com/${user}/${repo}/blob/${branch}/${subpath}";
    name = "<${repo}/${subpath}>";
  };

  nixcordPath = toString ./..;

  transformOptions =
    opt:
    opt
    // {
      declarations = (
        map (
          decl:
          if (lib.hasPrefix nixcordPath (toString decl)) then
            (githubDeclaration "FlameFlag" "nixcord" "main" (
              lib.removePrefix "/" (lib.removePrefix nixcordPath (toString decl))
            ))
          else
            decl
        ) opt.declarations
      );
    };

  buildOptionsDocs = (
    { modules, ... }:
    let
      opts =
        (lib.evalModules {
          inherit modules;
          class = "homeManager";
          specialArgs = { inherit pkgs; };
        }).options;
      options = builtins.removeAttrs opts [ "_module" ];
    in
    pkgs.buildPackages.nixosOptionsDoc {
      inherit options;
      inherit transformOptions;
      warningsAreErrors = false;
    }
  );

  nixcordOptionsDoc = buildOptionsDocs { inherit modules; };

  nixcord-options = pkgs.callPackage ./nixcord-options.nix {
    nixos-render-docs = pkgs.nixos-render-docs;
    nixcord-options = nixcordOptionsDoc.optionsJSON;
    revision = "latest";
  };
in
{
  html = nixcord-options;
  json = nixcordOptionsDoc.optionsJSON;
}
