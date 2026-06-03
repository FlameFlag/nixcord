{ testLib, lib }:

let
  inherit (testLib.assertions) hmWarnings;
in
{
  "disabled module is quiet" =
    let
      config = testLib.eval.hm {
        enable = false;
      };
    in
    assert config.assertions == [ ];
    assert config.warnings == [ ];
    true;

  "renamed target plugin is not deprecated" =
    let
      warnings = hmWarnings {
        enable = true;
        config.plugins.userMessagesPronouns.enable = true;
      };
    in
    assert warnings == [ ];
    true;

  "same-name active plugin rename is not deprecated" =
    let
      warnings = hmWarnings {
        enable = true;
        config.plugins.petpet.enable = true;
      };
    in
    assert warnings == [ ];
    true;

  "deprecated discord autoscroll option warns" =
    let
      warnings = hmWarnings {
        enable = true;
        discord.autoscroll.enable = true;
      };
    in
    assert builtins.any (
      message: lib.strings.hasInfix "discord.autoscroll.enable is deprecated" message
    ) warnings;
    assert builtins.any (message: lib.strings.hasInfix "discord.commandLineArgs" message) warnings;
    true;

  "deprecated discord autoscroll false option warns" =
    let
      warnings = hmWarnings {
        enable = true;
        discord.autoscroll.enable = false;
      };
    in
    assert builtins.any (
      message: lib.strings.hasInfix "discord.autoscroll.enable is deprecated" message
    ) warnings;
    true;

  "deprecated typed plugin name warns with replacement" =
    let
      warnings = hmWarnings {
        enable = true;
        config.plugins.PronounDB.enable = true;
      };
    in
    assert builtins.any (message: lib.hasInfix "PronounDB" message) warnings;
    assert builtins.any (message: lib.hasInfix "userMessagesPronouns" message) warnings;
    true;

  "deprecated normalized plugin name warns with replacement" =
    let
      warnings = hmWarnings {
        enable = true;
        config.plugins.anammox.enable = true;
      };
    in
    assert builtins.any (message: lib.hasInfix "anammox" message) warnings;
    assert builtins.any (message: lib.hasInfix "declutter" message) warnings;
    true;

  "deprecated freeform plugin name warns" =
    let
      warnings = hmWarnings {
        enable = true;
        extraConfig.plugins.PronounDB.enable = true;
      };
    in
    assert builtins.any (message: lib.hasInfix "PronounDB" message) warnings;
    true;

  "deprecated freeform upstream plugin name warns with normalized replacement" =
    let
      warnings = hmWarnings {
        enable = true;
        extraConfig.plugins.Anammox.enable = true;
      };
    in
    assert builtins.any (message: lib.hasInfix "Anammox" message) warnings;
    assert builtins.any (message: lib.hasInfix "declutter" message) warnings;
    true;
}
