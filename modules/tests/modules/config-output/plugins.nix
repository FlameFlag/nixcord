{ testLib }:

let
  common = import ./common.nix { inherit testLib; };
  inherit (common) baseConfig discordModSettingsJSON recursiveUpdate;
  inherit (testLib) lib pkgs;
  localPlugin = ../../../../packages/parser/tests/fixtures/equicord/src/plugins/shared-plugin;
  stubEquicordPackage = pkgs.runCommand "nixcord-equicord-stub" { } "mkdir $out" // {
    overrideAttrs =
      f:
      let
        attrs = f {
          postPatch = "";
          postInstall = "";
        };
      in
      pkgs.runCommand "nixcord-equicord-final-stub" { } "mkdir $out" // attrs;
  };
in
{
  "enabled plugin appears in generated settings" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.plugins.alwaysAnimate.enable = true;
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.plugins.AlwaysAnimate.enabled == true;
    true;

  "acronym plugin option emits upstream JSON key" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.plugins.clearUrls.enable = true;
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.plugins.ClearURLs.enabled == true;
    assert !(settingsJson.plugins ? ClearUrls);
    true;

  "legacy acronym plugin option still emits upstream JSON key" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.plugins.ClearURLs.enable = true;
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.plugins.ClearURLs.enabled == true;
    assert !(settingsJson.plugins ? ClearUrls);
    true;

  "acronym plugin setting option emits upstream JSON key" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.plugins.xsOverlay = {
            enable = true;
            preferUdp = true;
          };
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.plugins.XSOverlay.enabled == true;
    assert settingsJson.plugins.XSOverlay.preferUDP == true;
    assert !(settingsJson.plugins.XSOverlay ? preferUdp);
    true;

  "disabled plugin appears as disabled in generated settings" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.plugins.alwaysAnimate.enable = false;
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.plugins.AlwaysAnimate.enabled == false;
    true;

  "plugin settings are copied to generated output" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.plugins.vcNarrator = {
            enable = true;
            volume = 0.5;
            joinMessage = "hello {{USER}}";
          };
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.plugins.VcNarrator.enabled == true;
    assert settingsJson.plugins.VcNarrator.volume == 0.5;
    assert settingsJson.plugins.VcNarrator.joinMessage == "hello {{USER}}";
    true;

  "extraConfig is merged into generated output" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          extraConfig.customSetting = "myValue";
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.customSetting == "myValue";
    true;

  "themeLinks are preserved in generated output" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.themeLinks = [ "https://example.com/theme.css" ];
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert builtins.elem "https://example.com/theme.css" settingsJson.themeLinks;
    true;

  "enabledThemeLinks are preserved in generated output" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.enabledThemeLinks = [ "https://example.com/enabled-theme.css" ];
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert builtins.elem "https://example.com/enabled-theme.css" settingsJson.enabledThemeLinks;
    true;

  "useQuickCss is renamed for generated output" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.useQuickCss = true;
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.useQuickCSS == true;
    true;

  "plugin UI element settings are copied to generated output" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          config.uiElements = {
            chatBarButtons.MessageLatency.enable = false;
            chatBarButtons.someCustomButton.enable = false;
            messagePopoverButtons.Translate.enable = true;
          };
        }
      );
      settingsJson = discordModSettingsJSON config;
    in
    assert settingsJson.uiElements.chatBarButtons.MessageLatency.enabled == false;
    assert settingsJson.uiElements.chatBarButtons.someCustomButton.enabled == false;
    assert settingsJson.uiElements.messagePopoverButtons.Translate.enabled == true;
    true;

  "local userPlugins are copied through the Nix store" =
    let
      config = testLib.eval.hm (
        recursiveUpdate baseConfig {
          discord.vencord.enable = false;
          discord.equicord = {
            enable = true;
            package = stubEquicordPackage;
          };
          userPlugins.BetterAudioDefaults = localPlugin;
        }
      );
      postPatch = builtins.unsafeDiscardStringContext config._nixcordTest.common.packages.equicord.postPatch;
      storePlugin = builtins.unsafeDiscardStringContext "${localPlugin}";
    in
    assert lib.hasInfix "cp -r ${storePlugin} src/userplugins/BetterAudioDefaults" postPatch;
    assert !(lib.hasInfix (toString localPlugin) postPatch);
    true;
}
