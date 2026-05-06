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
  openasar ? null,
  brotli,
  libpulseaudio,
  # Krisp noise cancellation patching
  python3,
  runCommand,
  darwin ? null,

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
  sources = lib.importJSON ./sources.json;

  platformName = if stdenvNoCC.hostPlatform.isLinux then "linux" else "osx";
  variantKey = "${platformName}-${branch}";
  source = sources.${variantKey} or (throw "discord: no source defined for ${variantKey}");

  inherit (source) version;

  withoutOpenSSL11 = lib.filter (input: !(lib.hasPrefix "openssl-1.1.1" (lib.getName input)));

  src = fetchurl { inherit (source.distro) url hash; };

  moduleSrcs = lib.mapAttrs (_: mod: fetchurl { inherit (mod) url hash; }) source.modules;

  moduleVersions = lib.mapAttrs (_: mod: mod.version) source.modules;

  krispSourceMeta = source.modules.discord_krisp or null;

  krispSrc =
    if withKrisp && krispSourceMeta != null then
      fetchurl { inherit (krispSourceMeta) url hash; }
    else
      null;

  # Modules to stage at install time. When Krisp is enabled we drop the bundled
  # discord_krisp here and deploy the patched version at runtime instead
  stagedModuleSrcs =
    if withKrisp && krispSrc != null then
      lib.removeAttrs moduleSrcs [ "discord_krisp" ]
    else
      moduleSrcs;

  # Krisp helper scripts from upstream nixpkgs PR #506089
  # (NixOS/nixpkgs@3fd9c5cd0268c221313e624f32ea0c328b0418f0)
  krispScriptsRev = "3fd9c5cd0268c221313e624f32ea0c328b0418f0";
  patchKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-krisp.py";
    hash = "sha256-pj0+CCUZqApYE02zfXnLvOoiIHbtLTT1JMzrJN86WDo=";
  };
  deployKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/deploy-krisp.py";
    hash = "sha256-KMlE7JsffW9KM6MIL+qGoIF0xxdGYHi33Vc18PuHgBU=";
  };

  variantPackages = {
    stable = discord;
    ptb = discord-ptb;
    canary = discord-canary;
    development = discord-development;
  };
  basePackageRaw = variantPackages.${branch};
  emptyOpenSSL11 = runCommand "openssl-1.1.1w-ignored" { } ''
    mkdir -p "$out/lib"
  '';
  basePackage =
    if stdenvNoCC.isLinux && ((basePackageRaw.override.__functionArgs or { }) ? openssl_1_1) then
      basePackageRaw.override { openssl_1_1 = emptyOpenSSL11; }
    else
      basePackageRaw;

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

  resourcesDir =
    if stdenvNoCC.isLinux then
      "$out/opt/${binaryName}/resources"
    else
      "\"$out/Applications/${binaryName}.app/Contents/Resources\"";

  # Patched Krisp noise-cancellation module.
  # On Linux: patch the ELF to bypass signature verification.
  # On macOS: patch the Mach-O and re-sign with an ad-hoc signature.
  patchedKrisp =
    if withKrisp && krispSrc != null then
      runCommand "discord-krisp-patched"
        {
          nativeBuildInputs = [
            (python3.withPackages (ps: [
              ps.lief
              ps.capstone
            ]))
          ]
          ++ [ brotli ];
        }
        (
          ''
            mkdir -p "$out"
            brotli -d < ${krispSrc} | tar xf - --strip-components=1 -C "$out"
            python3 ${patchKrispPy} "$out/discord_krisp.node"
          ''
          + lib.optionalString stdenvNoCC.isDarwin ''
            source ${darwin.signingUtils}
            sign "$out/discord_krisp.node"
          ''
        )
    else
      null;

  # Runtime deployer: copies the patched Krisp module into Discord's config dir
  # before Discord starts and watches for the module updater overwriting it.
  deployKrisp =
    if withKrisp && patchedKrisp != null then
      runCommand "deploy-krisp.py"
        {
          pythonInterpreter = "${python3.withPackages (ps: [ ps.watchdog ])}/bin/python3";
          krispPath = "${patchedKrisp}";
          discordVersion = version;
          configDirName = lib.toLower binaryName;
          meta.mainProgram = "deploy-krisp.py";
        }
        ''
          mkdir -p "$out/bin"
          cp ${deployKrispPy} "$out/bin/deploy-krisp.py"
          substituteAllInPlace "$out/bin/deploy-krisp.py"
          chmod +x "$out/bin/deploy-krisp.py"
        ''
    else
      null;

  updateScript = writeShellApplication {
    name = "discord-update";
    runtimeInputs = [
      cacert
      nix
      curl
      jq
      python3
    ];
    text = ''
      export DISCORD_BRANCHES="''${DISCORD_BRANCHES:-stable,ptb,canary,development}"
      exec python3 ${./update-sources.py}
    '';
  };
in
basePackage.overrideAttrs (oldAttrs: {
  inherit version src;
  passthru = (oldAttrs.passthru or { }) // {
    inherit
      updateScript
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
  nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [ brotli ];
  buildInputs =
    withoutOpenSSL11 (oldAttrs.buildInputs or [ ])
    ++ lib.optionals stdenvNoCC.isLinux [ libpulseaudio ];

  autoPatchelfIgnoreMissingDeps = (oldAttrs.autoPatchelfIgnoreMissingDeps or [ ]) ++ lib.optionals
    stdenvNoCC.isLinux
    [
      "libssl.so.1.1"
      "libcrypto.so.1.1"
    ];

  unpackPhase = ''
    runHook preUnpack
    brotli -d < $src | tar xf - --strip-components=1
    ${lib.optionalString stdenvNoCC.isDarwin ''
      find . -type l -exec chmod -h u+rwx {} +
    ''}
    ${lib.concatStringsSep "\n" (
      lib.mapAttrsToList (name: msrc: ''
        mkdir -p modules/${name}
        brotli -d < ${msrc} | tar xf - --strip-components=1 -C modules/${name}
        ${lib.optionalString stdenvNoCC.isDarwin ''
          find modules/${name} -type l -exec chmod -h u+rwx {} +
        ''}
      '') stagedModuleSrcs
    )}
    runHook postUnpack
  '';

  sourceRoot = ".";

  installPhase =
    if stdenvNoCC.isDarwin then
      builtins.replaceStrings
        [
          ''cp -r "${binaryName}.app" $out/Applications''
          ''cp -R "${binaryName}.app" $out/Applications''
        ]
        [
          ''tar cf - "${binaryName}.app" | tar xf - -C $out/Applications''
          ''tar cf - "${binaryName}.app" | tar xf - -C $out/Applications''
        ]
        oldAttrs.installPhase
    else
      oldAttrs.installPhase;

  postInstall =
    (oldAttrs.postInstall or "")
    + lib.optionalString (withOpenASAR && openasar != null) ''
      cp -f ${openasar} ${resourcesDir}/app.asar
    ''
    + lib.optionalString (withVencord && vencord != null) ''
      mv ${resourcesDir}/app.asar ${resourcesDir}/_app.asar
      mkdir ${resourcesDir}/app.asar
      echo '{"name":"discord","main":"index.js"}' > ${resourcesDir}/app.asar/package.json
      echo 'require("${vencord}/patcher.js")' > ${resourcesDir}/app.asar/index.js
    ''
    + lib.optionalString (withEquicord && equicord != null) ''
      mv ${resourcesDir}/app.asar ${resourcesDir}/_app.asar
      mkdir ${resourcesDir}/app.asar
      echo '{"name":"discord","main":"index.js"}' > ${resourcesDir}/app.asar/package.json
      echo 'require("${equicord}/desktop/patcher.js")' > ${resourcesDir}/app.asar/index.js
    '';

  postFixup =
    (oldAttrs.postFixup or "")
    # Deploy the patched Krisp module at launch time via an extra --run hook.
    + (
      if withKrisp && deployKrisp != null then
        if stdenvNoCC.isLinux then
          ''
            wrapProgramShell $out/opt/${binaryName}/${binaryName} \
              --run ${lib.getExe deployKrisp}
          ''
        else
          ''
            wrapProgram "$out/bin/${binaryName}" \
              --run ${lib.getExe deployKrisp}
          ''
      else
        ""
    )
    + lib.optionalString enableAutoscroll (
      if stdenvNoCC.isLinux then
        ''
          wrapProgramShell $out/opt/${binaryName}/${binaryName} \
            --add-flags "--enable-blink-features=MiddleClickAutoscroll"
        ''
      else
        ''
          wrapProgram "$out/bin/${binaryName}" \
            --add-flags "--enable-blink-features=MiddleClickAutoscroll"
        ''
    );
})
