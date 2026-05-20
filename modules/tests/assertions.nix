# Tests that module assertions and warnings fire correctly.
# Validates: mutual exclusivity, plugin/client mismatch detection.
{ pkgs }:

let
  lib = pkgs.lib;
  testLib = import ./lib.nix { inherit pkgs; };
  inherit (testLib)
    evalHM
    evalHMAssertionFails
    getHMAssertionMessages
    getHMWarnings
    firstSharedPlugin
    firstVencordOnlyPlugin
    firstEquicordOnlyPlugin
    ;

  # --- Test: enabling both vencord and equicord for discord triggers assertion ---
  mutualExclusivityTest =
    let
      fails = evalHMAssertionFails {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = true;
      };
    in
    assert fails;
    true;

  # --- Test: the error message mentions mutual exclusivity ---
  mutualExclusivityMessageTest =
    let
      messages = getHMAssertionMessages {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = true;
      };
    in
    assert builtins.any (m: lib.hasInfix "mutually exclusive" m) messages;
    true;

  # --- Test: enabling only vencord passes assertion ---
  vencordOnlyPassesTest =
    let
      fails = evalHMAssertionFails {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = false;
      };
    in
    assert !fails;
    true;

  # --- Test: equicord-only plugin with vencord-only client triggers assertion ---
  equicordPluginWithVencordTest =
    let
      fails = evalHMAssertionFails {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = false;
        vesktop.enable = false;
        equibop.enable = false;
        config.plugins.${firstEquicordOnlyPlugin}.enable = true;
      };
    in
    assert fails;
    true;

  # --- Test: equicord-only plugin error message lists the plugin ---
  equicordPluginMessageTest =
    let
      messages = getHMAssertionMessages {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = false;
        vesktop.enable = false;
        equibop.enable = false;
        config.plugins.${firstEquicordOnlyPlugin}.enable = true;
      };
    in
    assert builtins.any (m: lib.hasInfix firstEquicordOnlyPlugin m) messages;
    true;

  # --- Test: vencord-only plugin with equicord-only client triggers assertion ---
  vencordPluginWithEquicordTest =
    let
      fails = evalHMAssertionFails {
        enable = true;
        discord.vencord.enable = false;
        discord.equicord.enable = true;
        vesktop.enable = false;
        equibop.enable = false;
        config.plugins.${firstVencordOnlyPlugin}.enable = true;
      };
    in
    assert fails;
    true;

  # --- Test: shared plugin works with either client ---
  sharedPluginPassesTest =
    let
      fails = evalHMAssertionFails {
        enable = true;
        discord.vencord.enable = true;
        config.plugins.${firstSharedPlugin}.enable = true;
      };
    in
    assert !fails;
    true;

  # --- Test: disabled module produces no assertions ---
  disabledModuleTest =
    let
      config = evalHM {
        enable = false;
      };
    in
    assert config.assertions == [ ];
    assert config.warnings == [ ];
    true;

  # --- Test: renamed target plugin does not trigger a deprecated-name warning ---
  renamedTargetPluginWarningTest =
    let
      warnings = getHMWarnings {
        enable = true;
        config.plugins.userMessagesPronouns.enable = true;
      };
    in
    assert warnings == [ ];
    true;

  # --- Test: deprecated typed plugin name still triggers a warning ---
  deprecatedTypedPluginWarningTest =
    let
      warnings = getHMWarnings {
        enable = true;
        config.plugins.PronounDB.enable = true;
      };
    in
    assert builtins.any (m: lib.hasInfix "PronounDB" m) warnings;
    assert builtins.any (m: lib.hasInfix "userMessagesPronouns" m) warnings;
    true;

  # --- Test: deprecated freeform plugin name still triggers a warning ---
  deprecatedFreeformPluginWarningTest =
    let
      warnings = getHMWarnings {
        enable = true;
        extraConfig.plugins.PronounDB.enable = true;
      };
    in
    assert builtins.any (m: lib.hasInfix "PronounDB" m) warnings;
    true;

  allTests =
    assert mutualExclusivityTest;
    assert mutualExclusivityMessageTest;
    assert vencordOnlyPassesTest;
    assert equicordPluginWithVencordTest;
    assert equicordPluginMessageTest;
    assert vencordPluginWithEquicordTest;
    assert sharedPluginPassesTest;
    assert disabledModuleTest;
    assert renamedTargetPluginWarningTest;
    assert deprecatedTypedPluginWarningTest;
    assert deprecatedFreeformPluginWarningTest;
    true;
in

pkgs.runCommand "assertions-test" { } ''
  ${if allTests then "echo 'All 11 assertion tests passed'" else "exit 1"}
  touch $out
''
