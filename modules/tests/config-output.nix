# Tests that module evaluation produces correct config outputs.
# Validates: generated settings JSON, file paths, plugin filtering, quickCSS, themes.
{ pkgs }:

let
  lib = pkgs.lib;
  testLib = import ./lib.nix { inherit pkgs; };
  inherit (testLib) evalHM getHomeFileJSON getHMActivationInstallJSON;

  ru = lib.recursiveUpdate;

  getDiscordModSettingsJSON =
    config:
    if config.home.activation ? nixcord-vencord-settings then
      getHMActivationInstallJSON config "nixcord-vencord-settings"
    else
      getHMActivationInstallJSON config "nixcord-equicord-settings";

  # Use explicit configDir so tests are platform-agnostic
  baseConfig = {
    enable = true;
    discord.vencord.enable = true;
    configDir = "/home/testuser/.config/Vencord";
    discord.configDir = "/home/testuser/.config/discord";
  };

  vesktopBaseConfig = {
    enable = true;
    discord.enable = false;
    vesktop.enable = true;
    vesktop.configDir = "/home/testuser/.config/vesktop";
  };

  # --- Test: enabled plugin appears in generated settings JSON ---
  pluginTest =
    let
      config = evalHM (
        ru baseConfig {
          config.plugins.alwaysAnimate.enable = true;
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.plugins.AlwaysAnimate.enabled == true;
    true;

  # --- Test: disabled plugin does not appear as enabled ---
  disabledPluginTest =
    let
      config = evalHM (
        ru baseConfig {
          config.plugins.alwaysAnimate.enable = false;
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.plugins.AlwaysAnimate.enabled == false;
    true;

  # --- Test: Discord mod settings are copied as writable activation files ---
  writableDiscordModSettingsTest =
    let
      config = evalHM baseConfig;
    in
    assert !(builtins.hasAttr "/home/testuser/.config/Vencord/settings/settings.json" config.home.file);
    assert config.home.activation ? nixcord-vencord-settings;
    true;

  # --- Test: quickCss generates a file when useQuickCss is true ---
  quickCssTest =
    let
      config = evalHM (
        ru baseConfig {
          config.useQuickCss = true;
          quickCss = "body { color: red; }";
        }
      );
    in
    assert
      (builtins.getAttr "/home/testuser/.config/Vencord/settings/quickCss.css" config.home.file).text
      == "body { color: red; }";
    true;

  # --- Test: quickCss file not created when quickCss is empty ---
  noQuickCssTest =
    let
      config = evalHM (
        ru baseConfig {
          config.useQuickCss = true;
          quickCss = "";
        }
      );
    in
    assert !(builtins.hasAttr "/home/testuser/.config/Vencord/settings/quickCss.css" config.home.file);
    true;

  # --- Test: configDir uses Equicord when equicord is enabled ---
  equicordConfigDirTest =
    let
      config = evalHM {
        enable = true;
        discord.vencord.enable = false;
        discord.equicord.enable = true;
      };
    in
    assert lib.hasSuffix "Equicord" (toString config.programs.nixcord.configDir);
    true;

  # --- Test: configDir uses Vencord when vencord is enabled ---
  vencordConfigDirTest =
    let
      config = evalHM {
        enable = true;
        discord.vencord.enable = true;
      };
    in
    assert lib.hasSuffix "Vencord" (toString config.programs.nixcord.configDir);
    true;

  # --- Test: discord settings.json generated when discord.settings is non-empty ---
  discordSettingsTest =
    let
      config = evalHM (
        ru baseConfig {
          discord.settings = {
            SKIP_HOST_UPDATE = true;
          };
        }
      );
      settingsJson = getHomeFileJSON config "/home/testuser/.config/discord/settings.json";
    in
    assert settingsJson.SKIP_HOST_UPDATE == true;
    true;

  # --- Test: vesktop settings are generated when vesktop is enabled ---
  vesktopSettingsTest =
    let
      config = evalHM (
        ru vesktopBaseConfig {
          config.plugins.alwaysAnimate.enable = true;
        }
      );
      settingsJson = getHomeFileJSON config "/home/testuser/.config/vesktop/settings/settings.json";
    in
    assert settingsJson.plugins.AlwaysAnimate.enabled == true;
    true;

  # --- Test: themes produce CSS files under vesktop ---
  themesTest =
    let
      config = evalHM (
        ru vesktopBaseConfig {
          config.themes.myTheme = "body { background: black; }";
        }
      );
    in
    assert
      (builtins.getAttr "/home/testuser/.config/vesktop/themes/myTheme.css" config.home.file).text
      == "body { background: black; }";
    true;

  # --- Test: plugin with settings produces correct output ---
  pluginWithSettingsTest =
    let
      config = evalHM (
        ru baseConfig {
          config.plugins.vcNarrator = {
            enable = true;
            volume = 0.5;
            joinMessage = "hello {{USER}}";
          };
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.plugins.VcNarrator.enabled == true;
    assert settingsJson.plugins.VcNarrator.volume == 0.5;
    assert settingsJson.plugins.VcNarrator.joinMessage == "hello {{USER}}";
    true;

  # --- Test: extraConfig is merged into output ---
  extraConfigTest =
    let
      config = evalHM (
        ru baseConfig {
          extraConfig.customSetting = "myValue";
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.customSetting == "myValue";
    true;

  # --- Test: themeLinks are preserved in settings ---
  themeLinksTest =
    let
      config = evalHM (
        ru baseConfig {
          config.themeLinks = [ "https://example.com/theme.css" ];
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert builtins.elem "https://example.com/theme.css" settingsJson.themeLinks;
    true;

  # --- Test: enabledThemeLinks are preserved in settings ---
  enabledThemeLinksTest =
    let
      config = evalHM (
        ru baseConfig {
          config.enabledThemeLinks = [ "https://example.com/enabled-theme.css" ];
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert builtins.elem "https://example.com/enabled-theme.css" settingsJson.enabledThemeLinks;
    true;

  # --- Test: useQuickCSS option is correctly renamed in JSON ---
  useQuickCssRenameTest =
    let
      config = evalHM (
        ru baseConfig {
          config.useQuickCss = true;
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.useQuickCSS == true;
    true;

  # --- Test: Equicord contentWarning trigger words are written to settings JSON ---
  contentWarningTriggerWordsTest =
    let
      config = evalHM (
        ru baseConfig {
          discord.vencord.enable = false;
          discord.equicord.enable = true;
          config.plugins.contentWarning = {
            enable = true;
            triggerWords = [
              "spoiler"
              "secret"
            ];
          };
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.plugins.ContentWarning.enabled == true;
    assert
      settingsJson.plugins.ContentWarning.triggerWords == [
        "spoiler"
        "secret"
      ];
    true;

  # --- Test: unset contentWarning trigger words keep the upstream DataStore fallback active ---
  contentWarningTriggerWordsUnsetTest =
    let
      config = evalHM (
        ru baseConfig {
          discord.vencord.enable = false;
          discord.equicord.enable = true;
          config.plugins.contentWarning.enable = true;
        }
      );
      settingsJson = getDiscordModSettingsJSON config;
    in
    assert settingsJson.plugins.ContentWarning.enabled == true;
    assert settingsJson.plugins.ContentWarning.triggerWords == null;
    true;

  allTests =
    assert pluginTest;
    assert disabledPluginTest;
    assert writableDiscordModSettingsTest;
    assert quickCssTest;
    assert noQuickCssTest;
    assert equicordConfigDirTest;
    assert vencordConfigDirTest;
    assert discordSettingsTest;
    assert vesktopSettingsTest;
    assert themesTest;
    assert pluginWithSettingsTest;
    assert extraConfigTest;
    assert themeLinksTest;
    assert enabledThemeLinksTest;
    assert useQuickCssRenameTest;
    assert contentWarningTriggerWordsTest;
    assert contentWarningTriggerWordsUnsetTest;
    true;
in

pkgs.runCommand "config-output-test" { } ''
  ${if allTests then "echo 'All 17 config output tests passed'" else "exit 1"}
  touch $out
''
