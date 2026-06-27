{ testLib, lib }:

let
  inherit (testLib.assertions) hmFails hmMessages hmWarnings;
in
{
  "discord cannot enable vencord and equicord together" =
    let
      fails = hmFails {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = true;
      };
    in
    assert fails;
    true;

  "mutual exclusivity failure explains the conflict" =
    let
      messages = hmMessages {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = true;
      };
    in
    assert builtins.any (message: lib.hasInfix "mutually exclusive" message) messages;
    true;

  "discord accepts vencord without equicord" =
    let
      fails = hmFails {
        enable = true;
        discord.vencord.enable = true;
        discord.equicord.enable = false;
      };
    in
    assert !fails;
    true;

  "discord warns when vencord and equicord are both disabled" =
    let
      warnings = hmWarnings {
        enable = true;
      };
    in
    assert builtins.any (message: lib.hasInfix "both disabled" message) warnings;
    assert builtins.any (message: lib.hasInfix "without Vencord or Equicord" message) warnings;
    true;

  "discord mod disabled warning is skipped when discord is disabled" =
    let
      warnings = hmWarnings {
        enable = true;
        discord.enable = false;
        vesktop.enable = true;
      };
    in
    assert !(builtins.any (message: lib.hasInfix "both disabled" message) warnings);
    true;
}
