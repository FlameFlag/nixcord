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
  sources = lib.importJSON ./sources.json;

  platformName = if stdenvNoCC.hostPlatform.isLinux then "linux" else "osx";
  variantKey = "${platformName}-${branch}";
  source = sources.${variantKey} or (throw "discord: no source defined for ${variantKey}");

  inherit (source) version;

  withoutOpenSSL11 = lib.filter (input: !(lib.hasPrefix "openssl-1.1.1" (lib.getName input)));

  src = fetchurl { inherit (source.distro) url hash; };

  darwinEntitlements = builtins.toFile "discord-entitlements.plist" (
    lib.generators.toPlist { escape = true; } {
      "com.apple.security.cs.allow-jit" = true;
      "com.apple.security.cs.allow-unsigned-executable-memory" = true;
      "com.apple.security.cs.disable-library-validation" = true;
      "com.apple.security.device.audio-input" = true;
      "com.apple.security.device.camera" = true;
    }
  );

  moduleSrcs = lib.mapAttrs (_: mod: fetchurl { inherit (mod) url hash; }) source.modules;

  moduleVersions = lib.mapAttrs (_: mod: mod.version) source.modules;

  configDirName =
    if stdenvNoCC.isDarwin then
      lib.replaceStrings [ " " ] [ "" ] (lib.toLower binaryName)
    else
      lib.toLower binaryName;

  krispSourceMeta = source.modules.discord_krisp or null;

  krispSrc =
    if withKrisp && krispSourceMeta != null then
      fetchurl { inherit (krispSourceMeta) url hash; }
    else
      null;

  # Modules to stage at install time. Keep discord_krisp out of the generic
  # staging path: when Krisp is enabled, the patched module is copied below;
  # when disabled, leaving it absent avoids loading a broken native addon.
  stagedModuleSrcs =
    if krispSourceMeta != null then lib.removeAttrs moduleSrcs [ "discord_krisp" ] else moduleSrcs;

  stagedModuleVersions =
    if withKrisp && krispSrc != null && stdenvNoCC.isDarwin then
      lib.removeAttrs moduleVersions [ "discord_krisp" ]
    else if withKrisp && krispSrc != null then
      moduleVersions
    else
      lib.filterAttrs (name: _: builtins.hasAttr name stagedModuleSrcs) moduleVersions;

  # Krisp helper scripts from upstream nixpkgs PR #506089
  # (NixOS/nixpkgs@90cdc6283e794e7e276fa60f6d27b98a27454f15)
  krispScriptsRev = "90cdc6283e794e7e276fa60f6d27b98a27454f15";
  patchKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-krisp.py";
    hash = "sha256-pj0+CCUZqApYE02zfXnLvOoiIHbtLTT1JMzrJN86WDo=";
  };
  patchKrispModulePy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-krisp-module.py";
    hash = "sha256-WyiDHH0l8rtcG0Dn8acZoeO8Wd2u9ZqaqNZqQlsAGM8=";
  };
  patchVoiceKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/patch-voice-krisp.py";
    hash = "sha256-HEfIv9br3oimd+wtvlBUqOmgv4HS0XRaO2O92ZOupos=";
  };
  deployKrispPy = fetchurl {
    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/${krispScriptsRev}/pkgs/applications/networking/instant-messengers/discord/deploy-krisp.py";
    hash = "sha256-3b1ymG+w3FIZtAIyw1wiRe3JC2vNDAC8d2YMHP9icxM=";
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

  # Krisp noise-cancellation module.
  # Patch the native module to bypass Discord's signature check. Darwin uses
  # nixpkgs' signingUtils so the patched module is ad-hoc signed with the
  # Nix-provided Darwin signing tool.
  krispModule =
    if withKrisp && krispSrc != null then
      runCommand "discord-krisp-module"
        {
          nativeBuildInputs = [
            brotli
          ]
          ++ lib.optionals (stdenvNoCC.isLinux || stdenvNoCC.isDarwin) [
            (python3.withPackages (ps: [
              ps.lief
              ps.capstone
            ]))
          ];
        }
        (
          ''
            mkdir -p "$out"
            brotli -d < ${krispSrc} | tar xf - --strip-components=1 -C "$out"
          ''
          + lib.optionalString (stdenvNoCC.isLinux || stdenvNoCC.isDarwin) ''
            python3 ${patchKrispPy} "$out/discord_krisp.node"
            python3 ${patchKrispModulePy} "$out" ${if stdenvNoCC.isDarwin then "darwin" else "linux"}
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
  # The watcher matters on Linux too: Discord/OpenASAR can touch native modules
  # during startup, and Krisp must remain a real writable copy, not a store link.
  deployKrisp =
    if withKrisp && krispModule != null && (stdenvNoCC.isLinux || stdenvNoCC.isDarwin) then
      runCommand "deploy-krisp.py"
        {
          pythonInterpreter = "${python3.withPackages (ps: [ ps.watchdog ])}/bin/python3";
          krispPath = "${krispModule}";
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

  # Discord's distro builds ship native modules separately from the host app.
  # Keep pinned modules linked where Discord/OpenASAR's module updater expects
  # them and repair manifests left behind by failed "undefined" module downloads.
  # On macOS, current Discord builds expose native modules through module_data
  # even when OpenASAR falls back to the legacy JS module updater.
  stageModules = writeShellApplication {
    name = "discord-stage-modules";
    runtimeInputs = [ jq ];
    text = ''
      store_modules="$1"
      config_dir="${
        if stdenvNoCC.isDarwin then
          "$HOME/Library/Application Support/${configDirName}"
        else
          "\${XDG_CONFIG_HOME:-$HOME/.config}/${configDirName}"
      }"
      modules_dir="$config_dir/${version}/modules"
      ${lib.optionalString stdenvNoCC.isDarwin ''
        module_data_dir="$config_dir/module_data"
      ''}
      staged_modules=" ${lib.concatStringsSep " " (lib.attrNames stagedModuleVersions)} "

      replace_link() {
        local src="$1"
        local dest="$2"

        if [ -L "$dest" ]; then
          rm "$dest"
        elif [ -e "$dest" ]; then
          chmod -R u+w "$dest" 2>/dev/null || true
          rm -rf "$dest"
        fi
        ln -s "$src" "$dest"
      }

      copy_module() {
        local src="$1"
        local dest="$2"

        if [ -L "$dest" ]; then
          rm "$dest"
        elif [ -e "$dest" ]; then
          chmod -R u+w "$dest" 2>/dev/null || true
          rm -rf "$dest"
        fi
        cp -R "$src" "$dest"
        chmod -R u+w "$dest"
      }

      prune_unstaged_modules() {
        local dir="$1"

        [ -d "$dir" ] || return 0
        for path in "$dir"/discord_*; do
          [ -e "$path" ] || continue
          module="$(basename "$path")"
          case "$staged_modules" in
            *" $module "*) ;;
            *)
              if [ -L "$path" ]; then
                rm "$path"
              else
                chmod -R u+w "$path" 2>/dev/null || true
                rm -rf "$path"
              fi
              rm -f "$dir/pending/$module"-*.zip 2>/dev/null || true
              ;;
          esac
        done
      }

      mkdir -p "$modules_dir" ${lib.optionalString stdenvNoCC.isDarwin ''"$module_data_dir"''}
      settings_file="$config_dir/settings.json"
      if [ -f "$settings_file" ]; then
        jq '. + {"SKIP_HOST_UPDATE": true, "SKIP_MODULE_UPDATE": true}' "$settings_file" > "$settings_file.tmp"
        mv "$settings_file.tmp" "$settings_file"
      else
        echo '{"SKIP_HOST_UPDATE": true, "SKIP_MODULE_UPDATE": true}' > "$settings_file"
      fi

      prune_unstaged_modules "$modules_dir"
      ${lib.optionalString stdenvNoCC.isDarwin ''
        prune_unstaged_modules "$module_data_dir"
      ''}
      for module in ${lib.concatStringsSep " " (lib.attrNames stagedModuleVersions)}; do
        if [ "$module" = discord_krisp ]; then
          copy_module "$store_modules/$module" "$modules_dir/$module"
        else
          replace_link "$store_modules/$module" "$modules_dir/$module"
        fi
        ${lib.optionalString stdenvNoCC.isDarwin ''
          if [ "$module" = discord_krisp ]; then
            copy_module "$store_modules/$module" "$module_data_dir/$module"
          else
            replace_link "$store_modules/$module" "$module_data_dir/$module"
          fi
        ''}
      done
      cat > "$modules_dir/installed.json.tmp" <<'EOF'
      ${builtins.toJSON (
        lib.mapAttrs (_: moduleVersion: { installedVersion = moduleVersion; }) stagedModuleVersions
      )}
      EOF
      mv "$modules_dir/installed.json.tmp" "$modules_dir/installed.json"
    '';
  };
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
    (oldAttrs.nativeBuildInputs or [ ])
    ++ [ brotli ]
    ++ lib.optionals stdenvNoCC.isDarwin [
      rcodesign
    ];
  buildInputs =
    withoutOpenSSL11 (oldAttrs.buildInputs or [ ])
    ++ lib.optionals stdenvNoCC.isLinux [ libpulseaudio ];

  dontUnpack = (oldAttrs.dontUnpack or false) || stdenvNoCC.isDarwin;

  dontStrip = (oldAttrs.dontStrip or false) || stdenvNoCC.isDarwin;

  autoPatchelfIgnoreMissingDeps =
    (oldAttrs.autoPatchelfIgnoreMissingDeps or [ ])
    ++ lib.optionals stdenvNoCC.isLinux [
      "libssl.so.1.1"
      "libcrypto.so.1.1"
    ];

  unpackPhase = ''
    runHook preUnpack

    extractDistro() {
      local src="$1"
      local dest="$2"
      local tarball
      tarball=$(mktemp)

      brotli -d < "$src" > "$tarball"
      tar xf "$tarball" --strip-components=1 -C "$dest"

      ${lib.optionalString stdenvNoCC.isDarwin ''
        # Discord's macOS distro tarballs store symlinks with mode 000. Darwin
        # tools cannot read those links reliably, so recreate them with normal
        # permissions from the tar metadata.
        ${python3.interpreter} -c 'import textwrap; exec(textwrap.dedent("""
        import pathlib
        import sys
        import tarfile

        with tarfile.open(sys.argv[1]) as tar:
            for member in tar:
                if not member.issym():
                    continue
                parts = pathlib.PurePosixPath(member.name).parts[1:]
                if not parts:
                    continue
                path = pathlib.Path(sys.argv[2], *parts)
                path.unlink(missing_ok=True)
                path.symlink_to(member.linkname)
        """))' "$tarball" "$dest"
      ''}

      rm "$tarball"
    }

    extractDistro "$src" .
    ${lib.concatStringsSep "\n" (
      lib.mapAttrsToList (name: msrc: ''
        mkdir -p modules/${name}
        extractDistro ${msrc} modules/${name}
      '') stagedModuleSrcs
    )}
    ${lib.optionalString (withKrisp && krispModule != null) ''
      mkdir -p modules/discord_krisp
      cp -R ${krispModule}/. modules/discord_krisp/
      chmod -R u+w modules/discord_krisp
    ''}
    runHook postUnpack
  '';

  sourceRoot = ".";

  installPhase =
    if stdenvNoCC.isDarwin then
      ''
        runHook preInstall

        mkdir -p "$out/Applications"

        extractDistro() {
          local src="$1"
          local dest="$2"
          local tarball
          tarball=$(mktemp)

          brotli -d < "$src" > "$tarball"
          tar xf "$tarball" --strip-components=1 -C "$dest"

          # Discord's macOS distro tarballs store symlinks with mode 000.
          # Recreate them so Darwin tooling can read the links reliably.
          ${python3.interpreter} -c 'import textwrap; exec(textwrap.dedent("""
          import pathlib
          import sys
          import tarfile

          with tarfile.open(sys.argv[1]) as tar:
              for member in tar:
                  if not member.issym():
                      continue
                  parts = pathlib.PurePosixPath(member.name).parts[1:]
                  if not parts:
                      continue
                  path = pathlib.Path(sys.argv[2], *parts)
                  path.unlink(missing_ok=True)
                  path.symlink_to(member.linkname)
          """))' "$tarball" "$dest"

          rm "$tarball"
        }

        extractDistro "$src" "$out/Applications"

        ${lib.concatStringsSep "\n" (
          lib.mapAttrsToList (name: msrc: ''
            mkdir -p "$out/Applications/${binaryName}.app/Contents/Resources/modules/${name}"
            extractDistro ${msrc} "$out/Applications/${binaryName}.app/Contents/Resources/modules/${name}"
          '') stagedModuleSrcs
        )}
        ${lib.optionalString (withKrisp && krispModule != null) ''
          mkdir -p "$out/Applications/${binaryName}.app/Contents/Resources/modules/discord_krisp"
          cp -R ${krispModule}/. "$out/Applications/${binaryName}.app/Contents/Resources/modules/discord_krisp/"
          chmod -R u+w "$out/Applications/${binaryName}.app/Contents/Resources/modules/discord_krisp"
        ''}

        mkdir -p "$out/bin"
        makeWrapper "$out/Applications/${binaryName}.app/Contents/MacOS/${binaryName}" "$out/bin/${binaryName}" \
          --run ${lib.getExe oldAttrs.passthru.disableBreakingUpdates} \
          --add-flags ""

        runHook postInstall
      ''
    else
      oldAttrs.installPhase;

  postInstall =
    (oldAttrs.postInstall or "")
    + lib.optionalString (stdenvNoCC.isLinux && !(withKrisp && krispModule != null)) ''
      ${python3.interpreter} - "$out/opt/${binaryName}/resources/build_info.json" "$out/opt/${binaryName}/modules" <<'PY'
      import json
      import sys
      from pathlib import Path

      build_info_path = Path(sys.argv[1])
      with build_info_path.open() as f:
          build_info = json.load(f)

      build_info["localModulesRoot"] = sys.argv[2]

      with build_info_path.open("w") as f:
          json.dump(build_info, f, indent=2)
          f.write("\n")
      PY
    ''
    + lib.optionalString (stdenvNoCC.isLinux && withKrisp && krispModule != null) ''
      ${python3.interpreter} ${patchVoiceKrispPy} \
        "$out/opt/${binaryName}/modules/discord_voice/index.js" \
        "require('path').join(process.env.XDG_CONFIG_HOME || require('path').join(require('os').homedir(), '.config'), '${lib.toLower binaryName}', '${version}', 'modules', 'discord_krisp')" \
        "$out/opt/${binaryName}/resources/build_info.json" \
        "$out/opt/${binaryName}/modules"
    ''
    + lib.optionalString stdenvNoCC.isDarwin ''
      find ${resourcesDir}/modules/discord_desktop_core/app/images/badges \
        -type f -name '*.ico' -size +104857600c -delete 2>/dev/null || true
    ''
    + lib.optionalString (stdenvNoCC.isDarwin && withKrisp && krispModule != null) ''
      ${python3.interpreter} ${patchVoiceKrispPy} \
        "${resourcesDir}/modules/discord_voice/index.js" \
        "require('path').join(require('os').userInfo().homedir, 'Library', 'Application Support', '${configDirName}', '${version}', 'modules', 'discord_krisp')"
    ''
    + lib.optionalString (withOpenASAR || withVencord || withEquicord) ''
      mkdir -p ${resourcesDir}/node_modules
      for module in ${lib.concatStringsSep " " (lib.attrNames stagedModuleVersions)}; do
        rm -rf ${resourcesDir}/node_modules/"$module"
        ln -s ../modules/"$module" ${resourcesDir}/node_modules/"$module"
      done
    ''
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
    # Stage the pinned distro modules where Discord/OpenASAR's JS module
    # updater expects them before the client starts.
    + lib.optionalString stdenvNoCC.isLinux ''
      wrapProgramShell $out/opt/${binaryName}/${binaryName} \
        --run "${lib.getExe stageModules} $out/opt/${binaryName}/modules" \
        ${lib.optionalString (withKrisp && deployKrisp != null) "--run ${lib.getExe deployKrisp}"}
    ''
    + lib.optionalString stdenvNoCC.isDarwin ''
      wrapProgram "$out/bin/${binaryName}" \
        --run "${lib.getExe stageModules} \"$out/Applications/${binaryName}.app/Contents/Resources/modules\""

      ${lib.getExe rcodesign} sign \
        --exclude "Contents/Resources/modules/**" \
        --entitlements-xml-file ${darwinEntitlements} \
        --entitlements-xml-file "Contents/Frameworks/${binaryName} Helper.app:${darwinEntitlements}" \
        --entitlements-xml-file "Contents/Frameworks/${binaryName} Helper (GPU).app:${darwinEntitlements}" \
        --entitlements-xml-file "Contents/Frameworks/${binaryName} Helper (Plugin).app:${darwinEntitlements}" \
        --entitlements-xml-file "Contents/Frameworks/${binaryName} Helper (Renderer).app:${darwinEntitlements}" \
        "$out/Applications/${binaryName}.app"
    ''
    # Let Discord's NVENC screenshare path find NVIDIA's driver libraries on NixOS.
    + lib.optionalString stdenvNoCC.isLinux ''
      wrapProgramShell $out/opt/${binaryName}/${binaryName} \
        --prefix LD_LIBRARY_PATH : /run/opengl-driver/lib
    ''
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
