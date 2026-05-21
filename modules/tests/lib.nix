# Shared test helpers for nixcord module tests.
# Provides stubs, evaluators, and assertion helpers for all three platforms.
{ pkgs }:

let
  lib = pkgs.lib.extend (
    _final: _prev: {
      hm.dag.entryAfter = after: data: {
        inherit after data;
      };
    }
  );

  # --- Plugin name sets (read dynamically from JSON) ---

  sharedPluginNames = builtins.attrNames (
    builtins.fromJSON (builtins.readFile ../plugins/shared.json)
  );
  vencordPluginNames = builtins.attrNames (
    builtins.fromJSON (builtins.readFile ../plugins/vencord.json)
  );
  equicordPluginNames = builtins.attrNames (
    builtins.fromJSON (builtins.readFile ../plugins/equicord.json)
  );

  sharedSet = lib.genAttrs sharedPluginNames (_: null);
  vencordSet = lib.genAttrs vencordPluginNames (_: null);
  equicordSet = lib.genAttrs equicordPluginNames (_: null);

  # First plugin exclusive to vencord (not in shared or equicord)
  firstVencordOnlyPlugin = lib.findFirst (
    n: !(sharedSet ? ${n}) && !(equicordSet ? ${n})
  ) (throw "no vencord-only plugin found") vencordPluginNames;

  # First plugin exclusive to equicord (not in shared or vencord)
  firstEquicordOnlyPlugin = lib.findFirst (
    n: !(sharedSet ? ${n}) && !(vencordSet ? ${n})
  ) (throw "no equicord-only plugin found") equicordPluginNames;

  # A shared plugin guaranteed to exist
  firstSharedPlugin = builtins.head sharedPluginNames;

  # --- Platform stubs ---

  hmStubs =
    { lib, ... }:
    {
      options = {
        home.homeDirectory = lib.mkOption {
          type = lib.types.path;
          default = "/home/testuser";
        };
        home.username = lib.mkOption {
          type = lib.types.str;
          default = "testuser";
        };
        xdg.configHome = lib.mkOption {
          type = lib.types.path;
          default = "/home/testuser/.config";
        };
        home.packages = lib.mkOption {
          type = lib.types.listOf lib.types.package;
          default = [ ];
        };
        home.file = lib.mkOption {
          type = lib.types.attrsOf lib.types.anything;
          default = { };
        };
        home.activation = lib.mkOption {
          type = lib.types.attrsOf lib.types.anything;
          default = { };
        };
        warnings = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
        };
        assertions = lib.mkOption {
          type = lib.types.listOf lib.types.anything;
          default = [ ];
        };
      };
    };

  nixosStubs =
    { lib, ... }:
    {
      options = {
        users.users = lib.mkOption {
          type = lib.types.attrsOf (
            lib.types.submodule {
              options = {
                name = lib.mkOption { type = lib.types.str; };
                home = lib.mkOption {
                  type = lib.types.path;
                  default = "/home/user";
                };
                isNormalUser = lib.mkOption {
                  type = lib.types.bool;
                  default = false;
                };
              };
            }
          );
          default = { };
        };
        system.stateVersion = lib.mkOption {
          type = lib.types.str;
          default = "25.11";
        };
        environment.systemPackages = lib.mkOption {
          type = lib.types.listOf lib.types.package;
          default = [ ];
        };
        system.activationScripts = lib.mkOption {
          type = lib.types.attrsOf lib.types.anything;
          default = { };
        };
        warnings = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
        };
        assertions = lib.mkOption {
          type = lib.types.listOf lib.types.anything;
          default = [ ];
        };
      };
    };

  darwinStubs =
    { lib, ... }:
    {
      options = {
        users.users = lib.mkOption {
          type = lib.types.attrsOf (
            lib.types.submodule {
              options = {
                name = lib.mkOption { type = lib.types.str; };
                home = lib.mkOption {
                  type = lib.types.path;
                  default = "/Users/user";
                };
              };
            }
          );
          default = { };
        };
        environment.systemPackages = lib.mkOption {
          type = lib.types.listOf lib.types.package;
          default = [ ];
        };
        system.activationScripts = lib.mkOption {
          type = lib.types.attrsOf lib.types.anything;
          default = { };
        };
        warnings = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
        };
        assertions = lib.mkOption {
          type = lib.types.listOf lib.types.anything;
          default = [ ];
        };
      };
    };

  # --- Evaluators ---

  evalHM =
    nixcordConfig:
    (lib.evalModules {
      modules = [
        hmStubs
        (import ../hm/default.nix)
        {
          _module.args.nixcordPkgs = { };
          programs.nixcord = {
            homeDirectory = "/home/testuser";
            xdgConfigHome = "/home/testuser/.config";
          }
          // nixcordConfig;
        }
      ];
      specialArgs = { inherit pkgs; };
    }).config;

  evalNixOS =
    nixcordConfig:
    (lib.evalModules {
      modules = [
        nixosStubs
        (import ../nixos/default.nix)
        {
          _module.args.nixcordPkgs = { };
          programs.nixcord = {
            user = "testuser";
          }
          // nixcordConfig;

          users.users.testuser = {
            name = "testuser";
            home = "/home/testuser";
            isNormalUser = true;
          };

          system.stateVersion = "25.11";
        }
      ];
      specialArgs = { inherit pkgs; };
    }).config;

  evalDarwin =
    nixcordConfig:
    (lib.evalModules {
      modules = [
        darwinStubs
        (import ../darwin/default.nix)
        {
          _module.args.nixcordPkgs = { };
          programs.nixcord = {
            user = "testuser";
          }
          // nixcordConfig;

          users.users.testuser = {
            name = "testuser";
            home = "/Users/testuser";
          };
        }
      ];
      specialArgs = { inherit pkgs; };
    }).config;

  # --- Assertion helpers ---

  evalHMAssertionFails =
    nixcordConfig:
    let
      config = evalHM nixcordConfig;
      failedAssertions = builtins.filter (a: !a.assertion) config.assertions;
    in
    failedAssertions != [ ];

  getHMAssertionMessages =
    nixcordConfig:
    let
      config = evalHM nixcordConfig;
      failedAssertions = builtins.filter (a: !a.assertion) config.assertions;
    in
    builtins.map (a: a.message) failedAssertions;

  getHMWarnings = nixcordConfig: (evalHM nixcordConfig).warnings;

  # Decode the JSON text content from a home.file entry
  getHomeFileJSON = config: path: builtins.fromJSON (builtins.getAttr path config.home.file).text;

  getHMActivationData =
    activation:
    if builtins.isAttrs activation && activation ? data then activation.data else activation;

  getHMActivationHereDoc =
    config: activationName:
    let
      script = getHMActivationData config.home.activation.${activationName};
      marker = ''cat > "$dest" <<'EOF'';
      findPayload =
        lines:
        if lines == [ ] then
          throw "activation ${activationName} does not write a heredoc"
        else if lib.hasInfix marker (builtins.head lines) then
          builtins.head (builtins.tail lines)
        else
          findPayload (builtins.tail lines);
    in
    findPayload (lib.splitString "\n" script);

  getHMActivationInstallJSON =
    config: activationName:
    builtins.fromJSON (
      builtins.unsafeDiscardStringContext (getHMActivationHereDoc config activationName)
    );

  # Serialize config fields safe to evaluate (no derivations)
  serializeEvalConfig =
    evaluatedConfig:
    let
      nixcordCfg = evaluatedConfig.programs.nixcord;
    in
    builtins.toJSON {
      inherit (nixcordCfg)
        enable
        user
        configDir
        quickCss
        ;
      pluginEnabled = nixcordCfg.config.plugins.${firstSharedPlugin}.enable;
      assertions = evaluatedConfig.assertions;
      warnings = evaluatedConfig.warnings;
    };

in
{
  inherit
    # Stubs
    hmStubs
    nixosStubs
    darwinStubs
    # Evaluators
    evalHM
    evalNixOS
    evalDarwin
    # Assertion helpers
    evalHMAssertionFails
    getHMAssertionMessages
    getHMWarnings
    getHomeFileJSON
    getHMActivationInstallJSON
    # Config serialization
    serializeEvalConfig
    # Dynamic plugin names
    firstSharedPlugin
    firstVencordOnlyPlugin
    firstEquicordOnlyPlugin
    ;
}
