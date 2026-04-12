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
    ../modules/options
    dontCheckModules
  ];

  githubDeclaration = user: repo: branch: subpath: {
    url = "https://github.com/${user}/${repo}/blob/${branch}/${subpath}";
    name = "<${repo}/${subpath}>";
  };

  nixcordPath = toString ./..;

  # Build a lookup from plugin name to the JSON file that defines it.
  pluginSourceFile =
    let
      readPlugins = file: builtins.attrNames (builtins.fromJSON (builtins.readFile file));
      tag = file: map (name: { inherit name file; }) (readPlugins file);
      all = tag ../modules/plugins/shared.json
        ++ tag ../modules/plugins/vencord.json
        ++ tag ../modules/plugins/equicord.json;
    in
    builtins.listToAttrs (map (entry: { name = entry.name; value = entry.file; }) all);

  transformOptions =
    opt:
    let
      isNixcordOption =
        lib.take 2 opt.loc == [
          "programs"
          "nixcord"
        ];
      isPluginOption =
        isNixcordOption
        && lib.length opt.loc >= 5
        && lib.elemAt opt.loc 2 == "config"
        && lib.elemAt opt.loc 3 == "plugins";
      pluginName = if isPluginOption then lib.elemAt opt.loc 4 else "";
      pluginFile =
        if isPluginOption && pluginSourceFile ? ${pluginName} then
          "modules/plugins/${builtins.baseNameOf (toString pluginSourceFile.${pluginName})}"
        else
          "modules/plugins";
      declarations =
        if isPluginOption then
          [ (githubDeclaration "FlameFlag" "nixcord" "main" pluginFile) ]
        else if isNixcordOption && (opt.declarations == [ ]) then
          [ (githubDeclaration "FlameFlag" "nixcord" "main" "modules/options") ]
        else
          map (
            decl:
            if (lib.hasPrefix nixcordPath (toString decl)) then
              (githubDeclaration "FlameFlag" "nixcord" "main" (
                lib.removePrefix "/" (lib.removePrefix nixcordPath (toString decl))
              ))
            else
              decl
          ) opt.declarations;
    in
    opt // { inherit declarations; };

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
