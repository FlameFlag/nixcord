{
  lib,
  pkgs,
  config,
  dop,
  defaultVencord,
}:
let
  inherit (lib)
    mkEnableOption
    mkOption
    types
    ;
in
{
  enable = mkEnableOption "Enables Discord with Vencord";
  discord = {
    enable = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Whether to enable discord
        Disable to only install Vesktop
      '';
    };
    installPackage = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to add `cfg.finalPackage.discord` to `home.packages`.";
    };
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ../pkgs/discord.nix (
        lib.optionalAttrs (
          pkgs.stdenvNoCC.isLinux && builtins.fromJSON (lib.versions.major lib.version) < 25
        ) { libgbm = pkgs.mesa; }
      );
      description = ''
        The Discord package to use
      '';
    };
    branch = mkOption {
      type = types.enum [
        "stable"
        "ptb"
        "canary"
        "development"
      ];
      default = "stable";
      description = "The Discord branch to use";
    };
    configDir = mkOption {
      type = types.path;
      default =
        let
          branch = config.programs.nixcord.discord.branch;
          baseConfigPath =
            if pkgs.stdenvNoCC.isLinux then
              config.xdg.configHome
            else
              "${config.home.homeDirectory}/Library/Application Support";
          branchDirName =
            {
              stable = "discord";
              ptb = "discordptb";
              canary = "discordcanary";
              development = "discorddevelopment";
            }
            .${branch};
        in
        "${baseConfigPath}/${branchDirName}";
      description = "Config path for Discord";
    };
    vencord = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Enable Vencord (for non-vesktop)";
      };
      package = mkOption {
        type = types.package;
        default = defaultVencord;
        description = ''
          The Vencord package to use
        '';
      };
      unstable = mkOption {
        type = types.bool;
        default = false;
        description = "Enable unstable Vencord build from repository's master branch";
      };
    };
    equicord = {
      enable = mkOption {
        type = types.bool;
        default = false;
        description = "Enable Equicord (alternative to Vencord)";
      };
      package = mkOption {
        type = types.package;
        default = pkgs.callPackage ../pkgs/equicord.nix { };
        description = ''
          The Equicord package to use
        '';
      };
    };
    openASAR.enable = mkOption {
      type = types.bool;
      default = true;
      description = "Enable OpenASAR (for non-vesktop)";
    };
    autoscroll.enable = mkOption {
      type = types.bool;
      default = false;
      description = "Enable middle-click autoscrolling";
    };
    settings = mkOption {
      type = types.attrs;
      default = { };
      description = ''
        Settings to be placed in discordConfigDir/settings.json
      '';
    };
  };
  vesktop = {
    enable = mkEnableOption ''
      Whether to enable Vesktop
    '';
    installPackage = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to add `cfg.finalPackage.vesktop` to `home.packages`.";
    };
    package = mkOption {
      type = types.package;
      default = pkgs.vesktop;
      description = ''
        The Vesktop package to use
      '';
    };
    useSystemVencord = mkOption {
      type = types.bool;
      default = true;
      description = "Use system Vencord package";
    };
    configDir = mkOption {
      type = types.path;
      default = "${
        if pkgs.stdenvNoCC.isLinux then
          config.xdg.configHome
        else
          "${config.home.homeDirectory}/Library/Application Support"
      }/vesktop";
      description = "Config path for Vesktop";
    };
    settings = mkOption {
      type = types.attrs;
      default = { };
      description = ''
        Settings to be placed in vesktop.configDir/settings.json
      '';
    };
    state = mkOption {
      type = types.attrs;
      default = { };
      description = ''
        Settings to be placed in vesktop.configDir/state.json
      '';
    };
    autoscroll.enable = mkOption {
      type = types.bool;
      default = false;
      description = "Enable middle-click autoscrolling";
    };
  };
  equibop = {
    enable = mkEnableOption ''
      Whether to enable Equibop
    '';
    installPackage = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to add `cfg.finalPackage.equibop` to `home.packages`.";
    };
    package = mkOption {
      type = types.nullOr types.package;
      default =
        if pkgs.stdenvNoCC.isDarwin then
          null
        else if pkgs ? equibop then
          pkgs.equibop
        else
          null;
      description = ''
        The Equibop package to use
      '';
    };
    useSystemEquicord = mkOption {
      type = types.bool;
      default = true;
      description = "Use system Equicord package instead of the bundled one";
    };
    configDir = mkOption {
      type = types.path;
      default = "${
        if pkgs.stdenvNoCC.isLinux then
          config.xdg.configHome
        else
          "${config.home.homeDirectory}/Library/Application Support"
      }/equibop";
      description = "Config path for Equibop";
    };
    settings = mkOption {
      type = types.attrs;
      default = { };
      description = ''
        Settings to be placed in equibop.configDir/settings.json
      '';
    };
    state = mkOption {
      type = types.attrs;
      default = { };
      description = ''
        Settings to be placed in equibop.configDir/state.json
      '';
    };
    autoscroll.enable = mkOption {
      type = types.bool;
      default = false;
      description = "Enable middle-click autoscrolling";
    };
  };
  dorion = {
    enable = mkEnableOption ''
      Whether to enable Dorion
    '';
    installPackage = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to add `cfg.finalPackage.dorion` to `home.packages`.";
    };
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ../pkgs/dorion.nix { };
      description = ''
        The Dorion package to use
      '';
    };
    configDir = mkOption {
      type = types.path;
      default = "${
        if pkgs.stdenvNoCC.isLinux then
          config.xdg.configHome
        else
          "${config.home.homeDirectory}/Library/Application Support"
      }/dorion";
      description = "Config path for Dorion";
    };
    theme = mkOption {
      type = types.str;
      default = "none";
      description = "Theme to use in Dorion";
    };
    themes = mkOption {
      type = types.listOf types.str;
      default = [ "none" ];
      description = "List of available themes";
    };
    zoom = mkOption {
      type = types.str;
      default = "1.0";
      description = "Zoom level for the client";
    };
    blur = mkOption {
      type = types.enum [
        "none"
        "blur"
        "acrylic"
      ];
      default = "none";
      description = "Window blur effect type";
    };
    blurCss = mkOption {
      type = types.bool;
      default = true;
      description = "Enable CSS blur effects";
    };
    useNativeTitlebar = mkOption {
      type = types.bool;
      default = false;
      description = "Use native window titlebar";
    };
    startMaximized = mkOption {
      type = types.bool;
      default = false;
      description = "Start Dorion maximized";
    };
    disableHardwareAccel = mkOption {
      type = types.bool;
      default = false;
      description = "Disable hardware acceleration";
    };
    sysTray = mkOption {
      type = types.bool;
      default = false;
      description = "Enable system tray integration";
    };
    trayIconEnabled = mkOption {
      type = types.bool;
      default = true;
      description = "Enable tray icon";
    };
    openOnStartup = mkOption {
      type = types.bool;
      default = false;
      description = "Open Dorion on system startup";
    };
    startupMinimized = mkOption {
      type = types.bool;
      default = false;
      description = "Start minimized to tray";
    };
    multiInstance = mkOption {
      type = types.bool;
      default = false;
      description = "Allow multiple Dorion instances";
    };
    pushToTalk = mkOption {
      type = types.bool;
      default = false;
      description = "Enable push-to-talk";
    };
    pushToTalkKeys = mkOption {
      type = types.listOf types.str;
      default = [ "RControl" ];
      description = "Keys for push-to-talk activation";
    };
    updateNotify = mkOption {
      type = types.bool;
      default = true;
      description = "Show update notifications";
    };
    desktopNotifications = mkOption {
      type = types.bool;
      default = false;
      description = "Enable desktop notifications";
    };
    unreadBadge = mkOption {
      type = types.bool;
      default = true;
      description = "Show unread message badge";
    };
    win7StyleNotifications = mkOption {
      type = types.bool;
      default = false;
      description = "Use Windows 7 style notifications";
    };
    cacheCss = mkOption {
      type = types.bool;
      default = false;
      description = "Cache CSS for faster loading";
    };
    autoClearCache = mkOption {
      type = types.bool;
      default = false;
      description = "Automatically clear cache on startup";
    };
    clientType = mkOption {
      type = types.str;
      default = "default";
      description = "Discord client type to emulate";
    };
    clientMods = mkOption {
      type = types.listOf types.str;
      default = [
        "Shelter"
        "Vencord"
      ];
      description = "Client modifications to enable";
    };
    clientPlugins = mkOption {
      type = types.bool;
      default = true;
      description = "Enable client plugins";
    };
    profile = mkOption {
      type = types.str;
      default = "default";
      description = "Profile name to use";
    };
    streamerModeDetection = mkOption {
      type = types.bool;
      default = false;
      description = "Enable streamer mode detection";
    };
    rpcServer = mkOption {
      type = types.bool;
      default = false;
      description = "Enable RPC server";
    };
    rpcProcessScanner = mkOption {
      type = types.bool;
      default = true;
      description = "Enable RPC process scanner";
    };
    rpcIpcConnector = mkOption {
      type = types.bool;
      default = true;
      description = "Enable RPC IPC connector";
    };
    rpcWebsocketConnector = mkOption {
      type = types.bool;
      default = true;
      description = "Enable RPC WebSocket connector";
    };
    rpcSecondaryEvents = mkOption {
      type = types.bool;
      default = true;
      description = "Enable RPC secondary events";
    };
    proxyUri = mkOption {
      type = types.str;
      default = "";
      description = "Proxy URI to use for connections";
    };
    keybinds = mkOption {
      type = types.attrs;
      default = { };
      description = "Custom keybind mappings";
    };
    keybindsEnabled = mkOption {
      type = types.bool;
      default = true;
      description = "Enable custom keybinds";
    };
    extraSettings = mkOption {
      type = types.attrs;
      default = { };
      description = ''
        Additional settings to merge into config.json.
        These will override any conflicting auto-generated settings.
      '';
    };
  };
  package = mkOption {
    type = with types; nullOr package;
    default = null;
    description = ''
      Deprecated
      The Discord package to use
    '';
  };
  vesktopPackage = mkOption {
    type = with types; nullOr package;
    default = null;
    description = ''
      The Vesktop package to use
    '';
  };
  configDir = mkOption {
    type = types.path;
    default =
      let
        base =
          if pkgs.stdenvNoCC.isLinux then
            config.xdg.configHome
          else
            "${config.home.homeDirectory}/Library/Application Support";
        dirName = if config.programs.nixcord.discord.equicord.enable then "Equicord" else "Vencord";
      in
      "${base}/${dirName}";
    description = "Config directory for the selected client (Vencord or Equicord)";
  };
  vesktopConfigDir = mkOption {
    type = with types; nullOr path;
    default = null;
    description = "Config path for Vesktop";
  };
  openASAR.enable = mkOption {
    type = with types; nullOr types.bool;
    default = null;
    description = "Enable OpenASAR (for non-vesktop)";
  };
  quickCss = mkOption {
    type = types.str;
    default = "";
    description = "Vencord quick CSS";
  };
  config = {
    notifyAboutUpdates = mkEnableOption "Notify when updates are available";
    autoUpdate = mkEnableOption "Automaticall update Vencord";
    autoUpdateNotification = mkEnableOption "Notify user about auto updates";
    useQuickCss = mkEnableOption "Enable quick CSS file";
    themeLinks = mkOption {
      type = with types; listOf types.str;
      default = [ ];
      description = "A list of links to online vencord themes";
      example = [ "https://raw.githubusercontent.com/rose-pine/discord/main/rose-pine.theme.css" ];
    };
    themes = mkOption {
      type =
        with types;
        attrsOf (oneOf [
          lines
          path
        ]);
      default = { };
      description = ''
        Themes to add, they can be enabled by settings
        `programs.nixcord.config.enabledThemes` to `[ "THEME_NAME.css" ]`
      '';
    };
    enabledThemes = mkOption {
      type = with types; listOf types.str;
      default = [ ];
      description = "A list of themes to enable from themes directory";
    };
    enableReactDevtools = mkEnableOption "Enable React developer tools";
    frameless = mkEnableOption "Make client frameless";
    transparent = mkEnableOption "Enable client transparency";
    disableMinSize = mkEnableOption "Disable minimum window size for client";
    plugins =
      let
        # Plugin name migration map (old -> new)
        pluginNameMigrations = import ./plugins/deprecated.nix;

        # Base plugins (new names only)
        basePlugins =
          lib.recursiveUpdate
            (lib.recursiveUpdate (import ./plugins/shared.nix { inherit lib; }) (
              import ./plugins/vencord.nix { inherit lib; }
            ))
            (import ./plugins/equicord.nix { inherit lib; });

        # Add old names as aliases pointing to new names
        # This allows old plugin names to be used in config while still being valid options
        aliasedPlugins = lib.foldl' (
          acc: oldName:
          let
            newName = pluginNameMigrations.${oldName};
            newPlugin = basePlugins.${newName} or null;
          in
          if newPlugin != null then
            # Create an alias: old name points to same structure as new name
            acc // { ${oldName} = newPlugin; }
          else
            acc
        ) basePlugins (builtins.attrNames pluginNameMigrations);
      in
      aliasedPlugins;
  };
  vesktopConfig = mkOption {
    type = types.attrs;
    default = { };
    description = ''
      additional config to be added to programs.nixcord.config
      for vesktop only
    '';
  };
  equibopConfig = mkOption {
    type = types.attrs;
    default = { };
    description = ''
      additional config to be added to programs.nixcord.config
      for equibop only
    '';
  };
  vencordConfig = mkOption {
    type = types.attrs;
    default = { };
    description = ''
      additional config to be added to programs.nixcord.config
      for vencord only
    '';
  };
  equicordConfig = mkOption {
    type = types.attrs;
    default = { };
    description = ''
      additional config to be added to programs.nixcord.config
      for equicord only
    '';
  };
  extraConfig = mkOption {
    type = types.attrs;
    default = { };
    description = ''
      additional config to be added to programs.nixcord.config
      for both vencord and vesktop
    '';
  };
  userPlugins =
    let
      regex = "github:([[:alnum:].-]+)/([[:alnum:]/-]+)/([0-9a-f]{40})";
      coerce =
        value:
        let
          matches = builtins.match regex value;
          owner = builtins.elemAt matches 0;
          repo = builtins.elemAt matches 1;
          rev = builtins.elemAt matches 2;
        in
        builtins.fetchGit {
          url = "https://github.com/${owner}/${repo}";
          inherit rev;
        };
    in
    mkOption {
      type = with types; attrsOf (coercedTo (strMatching regex) coerce dop);
      description = "User plugin to fetch and install. Note that any json required must be enabled in extraConfig";
      default = { };
      example = {
        someCoolPlugin = "github:someUser/someCoolPlugin/someHashHere";
      };
    };
  parseRules = {
    upperNames = mkOption {
      type = with types; listOf types.str;
      description = "option names to become UPPER_SNAKE_CASE";
      default = [ ];
    };
    lowerPluginTitles = mkOption {
      type = with types; listOf types.str;
      description = "plugins with lowercase names in json";
      default = [ ];
      example = [ "petpet" ];
    };
  };

  finalPackage = {
    discord = mkOption {
      type = with types; package;
      readOnly = true;
      description = "The final discord package that is created";
    };

    vesktop = mkOption {
      type = with types; package;
      readOnly = true;
      description = "The final vesktop package that is created";
    };
    equibop = mkOption {
      type = with types; nullOr package;
      readOnly = true;
      description = "The final equibop package that is created (null if package is not provided)";
    };

    dorion = mkOption {
      type = with types; package;
      readOnly = true;
      description = "The final dorion package that is created";
    };
  };
}
