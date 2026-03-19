{
  stdenvNoCC,
  lib,
  nodejs,
  bun,
  writableTmpDirAsHomeHook,
  vencord,
  equicord,
  nix,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  name = "nixcord-plugin-options";
  version = "generated";

  src = lib.cleanSourceWith {
    src = ../.;
    filter =
      path: type:
      let
        baseName = baseNameOf path;
        relPath = lib.removePrefix (toString ../. + "/") (toString path);
      in
      baseName == "package.json"
      || baseName == "bun.lock"
      || baseName == "tsconfig.base.json"
      || baseName == "vitest.workspace.ts"
      || baseName == "vitest.projects.ts"
      || relPath == "modules"
      || relPath == "modules/plugins"
      || relPath == "modules/plugins/deprecated.nix"
      || relPath == "packages"
      ||
        lib.hasPrefix "packages/" relPath
        && !(lib.hasInfix "node_modules" relPath)
        && !(lib.hasInfix "/dist/" relPath);
  };

  node_modules = stdenvNoCC.mkDerivation {
    pname = "nixcord-node_modules";
    inherit (finalAttrs) version src;

    impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [
      "GIT_PROXY_COMMAND"
      "SOCKS_SERVER"
    ];

    nativeBuildInputs = [
      bun
      writableTmpDirAsHomeHook
    ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      bun install \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      find . -type d -name node_modules -exec cp -R --parents {} $out \;

      runHook postInstall
    '';

    dontFixup = true;

    outputHash = "sha256-iRDjSgJNrQGhmThU1b0VnS3ZS3ssBMxAYnF9cuax7+g=";
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  };

  nativeBuildInputs = [
    bun
    nodejs
    nix
    writableTmpDirAsHomeHook
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    bun run --filter '*' build
    runHook postBuild
  '';

  doCheck = true;

  checkPhase = ''
    runHook preCheck
    ./node_modules/.bin/vitest run
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/plugins"
    cp modules/plugins/deprecated.nix "$out/plugins/deprecated.nix"

    ${lib.getExe nodejs} packages/cli/dist/index.js \
      --vencord "${vencord.src}" \
      --vencord-plugins src/plugins \
      --equicord "${equicord.srcWithGit or equicord.src}" \
      --equicord-plugins src/equicordplugins \
      --output "$out/dummy.nix" \
      --verbose

    runHook postInstall
  '';

  doInstallCheck = true;

  installCheckPhase = ''
    runHook preInstallCheck

    export NIX_STATE_DIR="$TMPDIR/nix-state"
    mkdir -p "$NIX_STATE_DIR"

    for nixFile in "$out/plugins"/*.nix; do
      if ! nix-instantiate --parse "$nixFile" > /dev/null 2>&1; then
        echo "ERROR: Invalid Nix syntax in $nixFile"
        nix-instantiate --parse "$nixFile" 2>&1 || true
        exit 1
      fi
    done

    runHook postInstallCheck
  '';
})
