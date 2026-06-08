{ lib, ... }:
let
  data = lib.importJSON ./migrations.json;

  base = [
    "programs"
    "nixcord"
    "config"
    "plugins"
  ];

  mkRemovedPluginModule = import ../lib/mkRemovedPluginModule.nix { inherit lib; };

  mkRenameModule =
    migration:
    lib.modules.doRename {
      from = base ++ migration.from;
      to = base ++ migration.to;
      visible = false;
      warn = migration.warn;
      use = x: x;
      condition = migration.condition or true;
    };
in
{
  imports =
    (map mkRenameModule data.renames)
    ++ (map mkRenameModule (data.identifierRenames or [ ]))
    ++ (map mkRemovedPluginModule data.removals);
}
