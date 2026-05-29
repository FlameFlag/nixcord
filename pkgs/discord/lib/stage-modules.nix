{
  lib,
  stdenvNoCC,
  writeShellApplication,
  jq,
  version,
  configDirName,
  stagedModuleVersions,
  disabledUpdateSettingsJson,
}:
writeShellApplication {
  name = "discord-stage-modules";
  runtimeInputs = [ jq ];
  text = ''
    export DISCORD_STAGE_PLATFORM=${if stdenvNoCC.isDarwin then "darwin" else "linux"}
    export DISCORD_CONFIG_DIR_NAME=${lib.escapeShellArg configDirName}
    export DISCORD_VERSION=${lib.escapeShellArg version}
    export DISCORD_STAGED_MODULES=${lib.escapeShellArg (lib.concatStringsSep " " (lib.attrNames stagedModuleVersions))}
    export DISCORD_DISABLED_UPDATE_SETTINGS_JSON=${lib.escapeShellArg disabledUpdateSettingsJson}
    export DISCORD_INSTALLED_MODULES_JSON=${
      lib.escapeShellArg (
        builtins.toJSON (
          lib.mapAttrs (_: moduleVersion: { installedVersion = moduleVersion; }) stagedModuleVersions
        )
      )
    }
    # shellcheck disable=SC1091
    source ${../scripts/stage-modules.sh} "$@"
  '';
}
