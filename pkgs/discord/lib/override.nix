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
  enableAutoscroll,
  resourcesDir,
  binaryName,
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
    export DISCORD_RESTORE_DARWIN_SYMLINKS=1
    export DISCORD_RESTORE_DARWIN_SYMLINKS_SCRIPT=${scripts.restoreDarwinSymlinks}
    export PYTHON=${python3.interpreter}
  '';
  scriptEnv = ''
    export DISCORD_SCRIPT_SHELL=${stdenv.shell}
  '';
in
basePackage.overrideAttrs (oldAttrs: {
  inherit version src;
  passthru = (oldAttrs.passthru or { }) // {
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
    (oldAttrs.nativeBuildInputs or [ ]) ++ [ brotli ] ++ lib.optional stdenvNoCC.isDarwin rcodesign;
  buildInputs =
    withoutOpenSSL11 (oldAttrs.buildInputs or [ ]) ++ lib.optional stdenvNoCC.isLinux libpulseaudio;

  dontUnpack = (oldAttrs.dontUnpack or false) || stdenvNoCC.isDarwin;

  dontStrip = (oldAttrs.dontStrip or false) || stdenvNoCC.isDarwin;

  hardeningEnable = lib.unique (
    (oldAttrs.hardeningEnable or [ ])
    ++ lib.optionals stdenvNoCC.isDarwin [
      "strictflexarrays3"
      "trivialautovarinit"
    ]
  );

  env =
    (oldAttrs.env or { })
    // lib.optionalAttrs (stdenvNoCC.isDarwin || ((oldAttrs.env or { }) ? NIX_CFLAGS_COMPILE)) {
      NIX_CFLAGS_COMPILE = lib.concatStringsSep " " (
        lib.optional ((oldAttrs.env or { }) ? NIX_CFLAGS_COMPILE) (toString oldAttrs.env.NIX_CFLAGS_COMPILE)
        ++ lib.optionals stdenvNoCC.isDarwin launcherCFlags
      );
    };

  autoPatchelfIgnoreMissingDeps =
    (oldAttrs.autoPatchelfIgnoreMissingDeps or [ ])
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
    (oldAttrs.postInstall or "")
    + lib.optionalString (stdenvNoCC.isLinux && !hasKrispModule) ''
      ${python3.interpreter} ${scripts.setLocalModulesRoot} \
        "$out/opt/${binaryName}/resources/build_info.json" \
        "$out/opt/${binaryName}/modules"
    ''
    + lib.optionalString (stdenvNoCC.isLinux && hasKrispModule) ''
      ${python3.interpreter} ${patchVoiceKrispPy} \
        "$out/opt/${binaryName}/modules/discord_voice/index.js" \
        "require('path').join(process.env.XDG_CONFIG_HOME || require('path').join(require('os').homedir(), '.config'), '${lib.toLower binaryName}', '${version}', 'modules', 'discord_krisp')" \
        "$out/opt/${binaryName}/resources/build_info.json" \
        "$out/opt/${binaryName}/modules"
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
    (oldAttrs.postFixup or "")
    + lib.optionalString stdenvNoCC.isLinux ''
      source ${scripts.wrapLinuxDiscord} \
        "$out/opt/${binaryName}/${binaryName}" \
        ${lib.getExe stageModules} \
        "$out/opt/${binaryName}/modules" \
        ${deployKrispArg} \
        ${if hasDeployKrisp then "1" else "0"} \
        ${if enableAutoscroll then "1" else "0"}
    ''
    + lib.optionalString stdenvNoCC.isDarwin ''
      source ${scripts.installDarwinLauncher} \
        ${lib.escapeShellArg binaryName} \
        ${launcherC} \
        ${lib.getExe oldAttrs.passthru.disableBreakingUpdates} \
        ${lib.getExe stageModules} \
        "$out/Applications/${binaryName}.app/Contents/Resources/modules" \
        ${deployKrispArg} \
        "$out/Applications/${binaryName}.app/Contents/MacOS/${binaryName}.unwrapped" \
        ${if hasDeployKrisp then "1" else "0"} \
        ${if enableAutoscroll then "1" else "0"} \
        ${stdenv.cc}/bin/cc \
        ${lib.getExe rcodesign} \
        ${darwinEntitlements}
    '';
})
