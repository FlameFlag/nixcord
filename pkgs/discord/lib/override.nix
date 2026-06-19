{
  lib,
  stdenvNoCC,
  stdenv,
  python3,
  brotli,
  rcodesign,
  libpulseaudio,
  asar,
  openasar,
  vencord,
  equicord,
  basePackage,
  version,
  src,
  updateScript,
  stageModules,
  source,
  moduleSrcs,
  moduleVersions,
  stagedModuleSrcs,
  stagedModuleVersions,
  withKrisp,
  krispModule,
  deployKrisp,
  patchVoiceKrispPy,
  withOpenASAR,
  withVencord,
  withEquicord,
  commandLineArgs,
  resourcesDir,
  binaryName,
  executableName,
  needsDiscordExecutableAlias,
  configDirName,
  nodeModulesTargetPrefix,
  darwinEntitlements,
  launcherCFlags,
  withoutOpenSSL11,
  scripts,
  launcherC,
}:
let
  moduleSpecArgs = lib.escapeShellArgs (
    lib.mapAttrsToList (name: moduleSrc: "${name}=${moduleSrc}") stagedModuleSrcs
  );
  stagedModuleNameArgs = lib.escapeShellArgs (lib.attrNames stagedModuleVersions);
  hasKrispModule = withKrisp && krispModule != null;
  hasDeployKrisp = withKrisp && deployKrisp != null;
  krispModuleArg = lib.optionalString hasKrispModule "${krispModule}";
  deployKrispArg = lib.escapeShellArg (lib.optionalString hasDeployKrisp (lib.getExe deployKrisp));
  darwinDistroEnv = lib.optionalString stdenvNoCC.isDarwin ''
    set -a
    ${lib.toShellVars {
      DISCORD_RESTORE_DARWIN_SYMLINKS = 1;
      DISCORD_RESTORE_DARWIN_SYMLINKS_SCRIPT = scripts.restoreDarwinSymlinks;
      PYTHON = python3.interpreter;
    }}
    set +a
  '';
  scriptEnv = ''
    set -a
    ${lib.toShellVars {
      DISCORD_SCRIPT_SHELL = stdenv.shell;
    }}
    set +a
  '';
  indexedCommandLineArgs = lib.lists.imap0 (index: arg: {
    inherit index arg;
  }) commandLineArgs;
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
  commandLineArgsString = lib.strings.escapeShellArgs commandLineArgs;
in
basePackage.overrideAttrs (
  oldAttrs:
  let
    oldEnv = oldAttrs.env or { };
    oldEnvHasNixCFlags = oldEnv ? NIX_CFLAGS_COMPILE;
    oldPassthru = oldAttrs.passthru or { };
    oldNativeBuildInputs = oldAttrs.nativeBuildInputs or [ ];
    oldBuildInputs = oldAttrs.buildInputs or [ ];
    oldDontUnpack = oldAttrs.dontUnpack or false;
    oldDontStrip = oldAttrs.dontStrip or false;
    oldHardeningEnable = oldAttrs.hardeningEnable or [ ];
    oldAutoPatchelfIgnoreMissingDeps = oldAttrs.autoPatchelfIgnoreMissingDeps or [ ];
    oldPostInstall = oldAttrs.postInstall or "";
    oldPostFixup = oldAttrs.postFixup or "";
    oldMeta = oldAttrs.meta or { };
  in
  {
    inherit version src;
    meta =
      oldMeta
      // lib.optionalAttrs needsDiscordExecutableAlias {
        mainProgram = "discord";
      };

    passthru = oldPassthru // {
      inherit
        updateScript
        stageModules
        source
        moduleSrcs
        moduleVersions
        ;
    };

    # Discord ships brotli-compressed tar "distros" with the host app split from
    # per-module native libraries. discord_dispatch is still linked against
    # openssl 1.1 on Linux, but that dependency is unused at runtime, so we ignore
    # it instead of forcing users to permit an insecure package. For nixpkgs
    # revisions that still take openssl_1_1 as a package argument, basePackage
    # overrides it with an empty placeholder before oldAttrs.buildInputs is
    # evaluated; then the placeholder is filtered out here.
    nativeBuildInputs =
      oldNativeBuildInputs ++ [ brotli ] ++ lib.optional stdenvNoCC.isDarwin rcodesign;
    buildInputs = withoutOpenSSL11 oldBuildInputs ++ lib.optional stdenvNoCC.isLinux libpulseaudio;

    dontUnpack = oldDontUnpack || stdenvNoCC.isDarwin;

    dontStrip = oldDontStrip || stdenvNoCC.isDarwin;

    hardeningEnable = lib.unique (
      oldHardeningEnable
      ++ lib.optionals stdenvNoCC.isDarwin [
        "strictflexarrays3"
        "trivialautovarinit"
      ]
    );

    env =
      oldEnv
      // lib.optionalAttrs (stdenvNoCC.isDarwin || oldEnvHasNixCFlags) {
        NIX_CFLAGS_COMPILE = lib.concatStringsSep " " (
          lib.optional oldEnvHasNixCFlags (toString oldEnv.NIX_CFLAGS_COMPILE)
          ++ lib.optionals stdenvNoCC.isDarwin launcherCFlags
        );
      };

    autoPatchelfIgnoreMissingDeps =
      oldAutoPatchelfIgnoreMissingDeps
      ++ lib.optionals stdenvNoCC.isLinux [
        "libssl.so.1.1"
        "libcrypto.so.1.1"
      ];

    unpackPhase = ''
      runHook preUnpack

      ${darwinDistroEnv}
      ${scriptEnv}
      source ${scripts.unpackDistroModules} \
        ${scripts.extractDistro} \
        "$src" \
        ${lib.escapeShellArg krispModuleArg} \
        ${moduleSpecArgs}

      runHook postUnpack
    '';

    sourceRoot = ".";

    installPhase =
      if stdenvNoCC.isDarwin then
        ''
          runHook preInstall

          ${darwinDistroEnv}
          ${scriptEnv}
          source ${scripts.installDarwinDistro} \
            ${scripts.extractDistro} \
            "$src" \
            ${lib.escapeShellArg binaryName} \
            ${lib.escapeShellArg krispModuleArg} \
            ${moduleSpecArgs}

          runHook postInstall
        ''
      else
        oldAttrs.installPhase;

    postInstall =
      oldPostInstall
      + lib.optionalString (stdenvNoCC.isLinux && !hasKrispModule && !withOpenASAR) ''
        ${python3.interpreter} ${scripts.setLocalModulesRoot} \
          "$out/opt/${binaryName}/resources/build_info.json" \
          "$out/opt/${binaryName}/modules"
      ''
      + lib.optionalString (stdenvNoCC.isLinux && hasKrispModule && !withOpenASAR) ''
        ${python3.interpreter} ${patchVoiceKrispPy} \
          "$out/opt/${binaryName}/modules/discord_voice/index.js" \
          "require('path').join(process.env.XDG_CONFIG_HOME || require('path').join(require('os').homedir(), '.config'), '${lib.toLower binaryName}', '${version}', 'modules', 'discord_krisp')" \
          "$out/opt/${binaryName}/resources/build_info.json" \
          "$out/opt/${binaryName}/modules"
      ''
      + lib.optionalString (stdenvNoCC.isLinux && hasKrispModule && withOpenASAR) ''
        ${python3.interpreter} ${patchVoiceKrispPy} \
          "$out/opt/${binaryName}/modules/discord_voice/index.js" \
          "require('path').join(process.env.XDG_CONFIG_HOME || require('path').join(require('os').homedir(), '.config'), '${lib.toLower binaryName}', '${version}', 'modules', 'discord_krisp')"
      ''
      + lib.optionalString stdenvNoCC.isDarwin ''
        source ${scripts.deleteLargeBadges} "${resourcesDir}"
      ''
      + lib.optionalString (stdenvNoCC.isDarwin && hasKrispModule) ''
        ${python3.interpreter} ${patchVoiceKrispPy} \
          "${resourcesDir}/modules/discord_voice/index.js" \
          "require('path').join(require('os').userInfo().homedir, 'Library', 'Application Support', '${configDirName}', '${version}', 'modules', 'discord_krisp')"
      ''
      + lib.optionalString (withOpenASAR || withVencord || withEquicord) ''
        source ${scripts.linkNodeModules} \
          "${resourcesDir}" \
          ${lib.escapeShellArg nodeModulesTargetPrefix} \
          ${stagedModuleNameArgs}
      ''
      + lib.optionalString (stdenvNoCC.isLinux && !withOpenASAR) ''
        source ${scripts.patchDiscordAppASAR} \
          "${resourcesDir}" \
          ${lib.getExe asar}
      ''
      + lib.optionalString (withOpenASAR && openasar != null) ''
        source ${scripts.installOpenASAR} \
          "${resourcesDir}" \
          ${openasar} \
          ${lib.getExe asar}
      ''
      + lib.optionalString (withVencord && vencord != null) ''
        source ${scripts.installPatcherASAR} \
          "${resourcesDir}" \
          ${lib.escapeShellArg ''require("${vencord}/patcher.js")''}
      ''
      + lib.optionalString (withEquicord && equicord != null) ''
        source ${scripts.installPatcherASAR} \
          "${resourcesDir}" \
          ${lib.escapeShellArg ''require("${equicord}/desktop/patcher.js")''}
      '';

    postFixup =
      oldPostFixup
      + lib.optionalString stdenvNoCC.isLinux ''
        source ${scripts.wrapLinuxDiscord} \
          "$out/opt/${binaryName}/${binaryName}" \
          ${lib.getExe stageModules} \
          "$out/opt/${binaryName}/modules" \
          ${deployKrispArg} \
          ${if hasDeployKrisp then "1" else "0"} \
          ${lib.strings.escapeShellArg commandLineArgsString}
      ''
      + lib.strings.optionalString stdenvNoCC.isDarwin ''
        source ${scripts.installDarwinLauncher} \
          ${lib.strings.escapeShellArg binaryName} \
          ${launcherC} \
          ${lib.getExe oldPassthru.disableBreakingUpdates} \
          ${lib.getExe stageModules} \
          "$out/Applications/${binaryName}.app/Contents/Resources/modules" \
          ${deployKrispArg} \
          "$out/Applications/${binaryName}.app/Contents/MacOS/${binaryName}.unwrapped" \
          ${if hasDeployKrisp then "1" else "0"} \
          ${lib.strings.escapeShellArg commandLineArgDeclarations} \
          ${lib.strings.escapeShellArg commandLineArgPointersWithComma} \
          ${toString (builtins.length commandLineArgs)} \
          ${stdenv.cc}/bin/cc \
          ${lib.meta.getExe rcodesign} \
          ${darwinEntitlements}
      ''
      + lib.optionalString needsDiscordExecutableAlias ''
        if [[ ! -e "$out/bin/${executableName}" ]]; then
          echo "expected Discord executable $out/bin/${executableName} to exist before creating alias" >&2
          exit 1
        fi

        if [[ ! -e "$out/bin/discord" ]]; then
          ln -s ${lib.escapeShellArg executableName} "$out/bin/discord"
        fi
      '';
  }
)
