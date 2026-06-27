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
  brotli,
  python3,
  runCommand,
  darwin ? null,
  rcodesign ? null,

  # Options
  branch ? "stable",
  withVencord ? false,
  vencord ? null,
  withEquicord ? false,
  equicord ? null,
  withOpenASAR ? false,
  openasar ? null,
  commandLineArgs ? [ ],
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

  variantPackages = {
    stable = discord;
    ptb = discord-ptb;
    canary = discord-canary;
    development = discord-development;
  };

  basePackage = variantPackages.${branch};

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

  resourcesDir =
    if stdenvNoCC.isLinux then
      "$out/opt/${binaryName}/resources"
    else
      "$out/Applications/${binaryName}.app/Contents/Resources";

  modulesDir =
    if stdenvNoCC.isLinux then
      "$out/opt/${binaryName}/modules"
    else
      "${resourcesDir}/modules";

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
    moduleSrcs
    moduleVersions
    krispSrc
    ;

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

  krisp = import ./lib/krisp.nix {
    inherit
      lib
      stdenvNoCC
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

  hasKrispModule = withKrisp && krispModule != null;
  hasDeployKrisp = withKrisp && deployKrisp != null;

  stagedModuleVersions = lib.removeAttrs moduleVersions [ "discord_krisp" ];

  disabledUpdateSettingsJson = builtins.toJSON {
    SKIP_HOST_UPDATE = true;
    SKIP_MODULE_UPDATE = true;
    USE_NEW_UPDATER = false;
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

  commandLineArgsString =
    if builtins.isList commandLineArgs then lib.escapeShellArgs commandLineArgs else commandLineArgs;
  commandLineArgsList = if builtins.isList commandLineArgs then commandLineArgs else [ ];

  indexedCommandLineArgs = lib.lists.imap0 (index: arg: {
    inherit index arg;
  }) commandLineArgsList;
  commandLineArgDeclarations = lib.strings.concatMapStringsSep "\n" (
    { index, arg }:
    "static char command_line_arg_${toString index}[] = \"${lib.strings.escapeC (lib.strings.stringToCharacters arg) arg}\";"
  ) indexedCommandLineArgs;
  commandLineArgPointers = lib.strings.concatMapStringsSep ", " (
    { index, ... }: "command_line_arg_${toString index}"
  ) indexedCommandLineArgs;
  commandLineArgPointersWithComma = lib.strings.optionalString (
    commandLineArgPointers != ""
  ) "${commandLineArgPointers},";

  krispRuntimePath =
    if stdenvNoCC.isLinux then
      "require('path').join(process.env.XDG_CONFIG_HOME || require('path').join(require('os').homedir(), '.config'), '${configDirName}', '${version}', 'modules', 'discord_krisp')"
    else
      "require('path').join(require('os').userInfo().homedir, 'Library', 'Application Support', '${configDirName}', '${version}', 'modules', 'discord_krisp')";

  overrideArgs =
    {
      inherit
        source
        withVencord
        withEquicord
        withOpenASAR
        ;
      commandLineArgs = if stdenvNoCC.isDarwin then "" else commandLineArgsString;
    }
    // lib.optionalAttrs (vencord != null) { inherit vencord; }
    // lib.optionalAttrs (equicord != null) { inherit equicord; }
    // lib.optionalAttrs (openasar != null) { inherit openasar; };

  package = basePackage.override overrideArgs;

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
package.overrideAttrs (
  oldAttrs:
  let
    oldEnv = oldAttrs.env or { };
    oldEnvHasNixCFlags = oldEnv ? NIX_CFLAGS_COMPILE;
    oldPassthru = oldAttrs.passthru or { };
  in
  {
    passthru = oldPassthru // {
      inherit
        updateScript
        source
        moduleSrcs
        moduleVersions
        ;
      nixcordCommandLineArgsList = true;
    };

    env =
      oldEnv
      // lib.optionalAttrs (stdenvNoCC.isDarwin || oldEnvHasNixCFlags) {
        NIX_CFLAGS_COMPILE = lib.concatStringsSep " " (
          lib.optional oldEnvHasNixCFlags (toString oldEnv.NIX_CFLAGS_COMPILE)
          ++ lib.optionals stdenvNoCC.isDarwin launcherCFlags
        );
      };

    postInstall =
      (oldAttrs.postInstall or "")
      + lib.optionalString hasKrispModule ''
        rm -rf "${modulesDir}/discord_krisp"
        mkdir -p "${modulesDir}/discord_krisp"
        cp -R "${krispModule}/." "${modulesDir}/discord_krisp/"
        chmod -R u+w "${modulesDir}/discord_krisp"

        ${python3.interpreter} ${patchVoiceKrispPy} \
          "${modulesDir}/discord_voice/index.js" \
          ${lib.escapeShellArg krispRuntimePath}
      '';

    postFixup =
      (oldAttrs.postFixup or "")
      + lib.optionalString (stdenvNoCC.isLinux && hasDeployKrisp) ''
        wrapProgramShell "$out/opt/${binaryName}/${binaryName}" \
          --run ${lib.escapeShellArg (lib.getExe deployKrisp)}
      ''
      + lib.optionalString stdenvNoCC.isDarwin ''
        source ${./scripts/install-darwin-launcher.sh} \
          ${lib.strings.escapeShellArg binaryName} \
          ${./src/discord-launcher.c} \
          ${lib.getExe oldPassthru.disableBreakingUpdates} \
          ${lib.getExe stageModules} \
          "${modulesDir}" \
          ${lib.escapeShellArg (lib.optionalString hasDeployKrisp (lib.getExe deployKrisp))} \
          "$out/Applications/${binaryName}.app/Contents/MacOS/${binaryName}.unwrapped" \
          ${if hasDeployKrisp then "1" else "0"} \
          ${lib.strings.escapeShellArg commandLineArgDeclarations} \
          ${lib.strings.escapeShellArg commandLineArgPointersWithComma} \
          ${toString (builtins.length commandLineArgsList)} \
          ${stdenv.cc}/bin/cc \
          ${lib.meta.getExe rcodesign} \
          ${darwinEntitlements}
      '';
  }
)
