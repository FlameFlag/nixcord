{
  lib,
  stdenvNoCC,
  fetchurl,
  branch,
  withKrisp,
}:
let
  sources = lib.importJSON ../data/sources.json;

  platformName = if stdenvNoCC.hostPlatform.isLinux then "linux" else "osx";
  variantKey = "${platformName}-${branch}";
  source = sources.${variantKey} or (throw "discord: no source defined for ${variantKey}");

  inherit (source) version;

  src = fetchurl { inherit (source.distro) url hash; };

  moduleSrcs = lib.mapAttrs (_: mod: fetchurl { inherit (mod) url hash; }) source.modules;

  moduleVersions = lib.mapAttrs (_: mod: mod.version) source.modules;

  krispSourceMeta = source.modules.discord_krisp or null;

  krispSrc =
    if withKrisp && krispSourceMeta != null then
      fetchurl { inherit (krispSourceMeta) url hash; }
    else
      null;

  # Modules to stage at install time. Keep discord_krisp out of the generic
  # staging path: when Krisp is enabled, the patched module is copied below;
  # when disabled, leaving it absent avoids loading a broken native addon.
  stagedModuleSrcs = lib.removeAttrs moduleSrcs [ "discord_krisp" ];

  stagedModuleVersions =
    if withKrisp && krispSourceMeta != null && stdenvNoCC.isLinux then
      moduleVersions
    else
      lib.removeAttrs moduleVersions [ "discord_krisp" ];
in
{
  inherit
    sources
    platformName
    variantKey
    source
    version
    src
    moduleSrcs
    moduleVersions
    krispSourceMeta
    krispSrc
    stagedModuleSrcs
    stagedModuleVersions
    ;
}
