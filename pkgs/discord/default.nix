{
  stdenvNoCC,
  stdenv,
  fetchurl,
  lib,
  discord,
  discord-ptb ? null,
  discord-canary ? null,
  discord-development ? null,
  writeShellApplication,
  cacert,
  curl,
  jq,
  nix,
  asar,
  openasar ? null,
  brotli,
  libpulseaudio,
  # Krisp noise cancellation patching
  python3,
  runCommand,
  darwin ? null,
  rcodesign,

  # Options
  branch ? "stable",
  withVencord ? false,
  vencord ? null,
  withEquicord ? false,
  equicord ? null,
  withOpenASAR ? false,
  enableAutoscroll ? false,
  withKrisp ? false,
}:
let
  launcherCFlags = [
    "-std=c23"
    "-Wall"
    "-Wextra"
    "-Wpedantic"
    "-Wconversion"
    "-Wsign-conversion"
    "-Wcast-qual"
    "-Wwrite-strings"
    "-Wformat=2"
    "-Wshadow"
    "-Wstrict-prototypes"
    "-Wmissing-prototypes"
    "-Wold-style-definition"
    "-Wundef"
    "-Wvla"
    "-Walloca"
    "-Werror"
  ];

  withoutOpenSSL11 = lib.filter (input: !(lib.hasPrefix "openssl-1.1.1" (lib.getName input)));

  binaryName =
    if stdenvNoCC.isLinux then
      {
        stable = "Discord";
        ptb = "DiscordPTB";
        canary = "DiscordCanary";
        development = "DiscordDevelopment";
      }
      .${branch}
    else
      {
        stable = "Discord";
        ptb = "Discord PTB";
        canary = "Discord Canary";
        development = "Discord Development";
      }
      .${branch};

  configDirName =
    if stdenvNoCC.isDarwin then
      lib.replaceStrings [ " " ] [ "" ] (lib.toLower binaryName)
    else
      lib.toLower binaryName;

  nodeModulesTargetPrefix = if stdenvNoCC.isLinux then "../../modules" else "../modules";

  resourcesDir =
    if stdenvNoCC.isLinux then
      "$out/opt/${binaryName}/resources"
    else
      "$out/Applications/${binaryName}.app/Contents/Resources";

  scripts = {
    deleteLargeBadges = ./scripts/delete-large-badges.sh;
    extractDistro = ./scripts/extract-distro.sh;
    installDarwinDistro = ./scripts/install-darwin-distro.sh;
    installDarwinLauncher = ./scripts/install-darwin-launcher.sh;
    installOpenASAR = ./scripts/install-openasar.sh;
    installPatcherASAR = ./scripts/install-patcher-asar.sh;
    linkNodeModules = ./scripts/link-node-modules.sh;
    restoreDarwinSymlinks = ./scripts/restore-darwin-symlinks.py;
    setLocalModulesRoot = ./scripts/set-local-modules-root.py;
    unpackDistroModules = ./scripts/unpack-distro-modules.sh;
    wrapLinuxDiscord = ./scripts/wrap-linux-discord.sh;
  };

  sourceSet = import ./lib/sources.nix {
    inherit
      lib
      stdenvNoCC
      fetchurl
      branch
      withKrisp
      ;
  };

  inherit (sourceSet)
    source
    version
    src
    moduleSrcs
    moduleVersions
    krispSrc
    stagedModuleSrcs
    stagedModuleVersions
    ;

  krisp = import ./lib/krisp.nix {
    inherit
      lib
      stdenvNoCC
      fetchurl
      brotli
      python3
      runCommand
      darwin
      withKrisp
      version
      binaryName
      krispSrc
      ;
    installDeployKrispScript = ./scripts/install-deploy-krisp.sh;
    patchKrispModuleScript = ./scripts/patch-krisp-module.sh;
  };

  inherit (krisp)
    krispModule
    deployKrisp
    patchVoiceKrispPy
    ;

  disabledUpdateSettings = {
    SKIP_HOST_UPDATE = true;
    SKIP_MODULE_UPDATE = true;
    USE_NEW_UPDATER = false;
  };

  disabledUpdateSettingsJson = builtins.toJSON disabledUpdateSettings;

  updateScript = import ./lib/update-script.nix {
    inherit
      writeShellApplication
      cacert
      nix
      curl
      jq
      python3
      ;
    updateSourcesPy = ./scripts/update-sources.py;
  };

  stageModules = import ./lib/stage-modules.nix {
    inherit
      lib
      stdenvNoCC
      writeShellApplication
      jq
      version
      configDirName
      stagedModuleVersions
      disabledUpdateSettingsJson
      ;
  };

  basePackage = import ./lib/base-package.nix {
    inherit
      stdenvNoCC
      runCommand
      branch
      discord
      discord-ptb
      discord-canary
      discord-development
      ;
  };

  darwinEntitlements = builtins.toFile "discord-entitlements.plist" (
    lib.generators.toPlist { escape = true; } {
      "com.apple.security.cs.allow-jit" = true;
      "com.apple.security.cs.allow-unsigned-executable-memory" = true;
      "com.apple.security.cs.disable-library-validation" = true;
      "com.apple.security.device.audio-input" = true;
      "com.apple.security.device.camera" = true;
    }
  );
in
import ./lib/override.nix {
  inherit
    lib
    stdenvNoCC
    stdenv
    python3
    brotli
    rcodesign
    libpulseaudio
    asar
    openasar
    vencord
    equicord
    basePackage
    version
    src
    updateScript
    stageModules
    source
    moduleSrcs
    moduleVersions
    stagedModuleSrcs
    stagedModuleVersions
    withKrisp
    krispModule
    deployKrisp
    patchVoiceKrispPy
    withOpenASAR
    withVencord
    withEquicord
    enableAutoscroll
    resourcesDir
    binaryName
    configDirName
    nodeModulesTargetPrefix
    darwinEntitlements
    launcherCFlags
    withoutOpenSSL11
    scripts
    ;
  launcherC = ./src/discord-launcher.c;
}
