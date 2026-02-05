{
  stdenv,
  lib,
  nodejs,
  importNpmLock,
  vencord,
  equicord,
  nix,
}:
stdenv.mkDerivation {
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
      || baseName == "package-lock.json"
      || baseName == "tsconfig.base.json"
      || baseName == "vitest.workspace.ts"
      || relPath == "packages"
      ||
        lib.hasPrefix "packages/" relPath
        && !(lib.hasInfix "node_modules" relPath)
        && !(lib.hasInfix "/dist/" relPath);
  };

  nativeBuildInputs = [
    nodejs
    nix
    importNpmLock.hooks.npmConfigHook
  ];

  npmDeps = importNpmLock { npmRoot = ../.;  };

  doCheck = true;

  checkPhase = ''
    runHook preCheck
    ./node_modules/.bin/vitest run
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    ${lib.getExe nodejs} --import tsx packages/cli/src/index.ts \
      --vencord "${vencord.src}" \
      --vencord-plugins src/plugins \
      --equicord "${equicord.src}" \
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
}
