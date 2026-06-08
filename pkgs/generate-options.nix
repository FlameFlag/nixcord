{
  stdenvNoCC,
  lib,
  nodejs,
  bun,
  writableTmpDirAsHomeHook,
  nix,
  vencordSource ? "node_modules/vencord",
  equicordSource ? "node_modules/equicord",
  skipGitMigrations ? true,
}:
let
  nodeModulesHashDarwin = "sha256-/1H8CLr7QVXecHhxOZouRUtfA6lD2vME7IFcwrZYsCM=";
  nodeModulesHashLinux = "sha256-Gsp5ZlbsRcg6rYa+unClgxuRr2HgnwlDSc1mRYBUUv4=";
  nodeModulesHash = if stdenvNoCC.isDarwin then nodeModulesHashDarwin else nodeModulesHashLinux;
in
stdenvNoCC.mkDerivation (finalAttrs: {
  name = "nixcord-plugin-options";
  version = "generated";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../docs/site/package.json
      ../tsconfig.base.json
      ../vitest.workspace.ts
      ../vitest.projects.ts
      ../vite.config.shared.ts
      ../modules/plugins/overrides.json
      ../modules/plugins/deprecated.nix
      ../modules/plugins/deprecated.json
      ../modules/plugins/migrations.nix
      ../packages
    ];
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
        --os=* \
        --cpu=* \
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

    outputHash = nodeModulesHash;
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
    chmod -R u+w ./node_modules ./docs/site/node_modules
    patchShebangs --build node_modules docs/site/node_modules

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    bun run --filter '@nixcord/shared' build
    bun run --filter '@nixcord/git-analyzer' build
    bun run --filter '@nixcord/ast' build
    bun run --filter '@nixcord/nix-generator' build
    bun run --filter '@nixcord/parser' build
    bun run --filter '@nixcord/cli' build
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
    cp modules/plugins/deprecated.json "$out/plugins/deprecated.json"
    cp modules/plugins/migrations.nix "$out/plugins/migrations.nix"

    ${lib.getExe nodejs} packages/cli/dist/index.js \
      --vencord "${vencordSource}" \
      --vencord-plugins src/plugins \
      --equicord "${equicordSource}" \
      --equicord-plugins src/equicordplugins \
      --output "$out/dummy.nix" \
      ${lib.optionalString skipGitMigrations "--skip-git-migrations"} \
      --verbose

    ${lib.getExe nodejs} <<'NODE'
      const fs = require("node:fs");
      const path = require("node:path");

      const overridesPath = "modules/plugins/overrides.json";
      if (!fs.existsSync(overridesPath)) process.exit(0);

      const isPlainObject = value =>
        value !== null && typeof value === "object" && !Array.isArray(value);

      const merge = (base, override) => {
        if (!isPlainObject(base) || !isPlainObject(override)) return override;

        const result = { ...base };
        for (const [key, value] of Object.entries(override)) {
          result[key] = key in result ? merge(result[key], value) : value;
        }
        return result;
      };

      const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
      const files = {
        shared: "shared.json",
        vencord: "vencord.json",
        equicord: "equicord.json",
      };

      for (const [category, filename] of Object.entries(files)) {
        if (!overrides[category]) continue;

        const targetPath = path.join(process.env.out, "plugins", filename);
        const generated = JSON.parse(fs.readFileSync(targetPath, "utf8"));
        const merged = merge(generated, overrides[category]);
        fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n");
      }
    NODE

    runHook postInstall
  '';

  doInstallCheck = true;

  installCheckPhase = ''
    runHook preInstallCheck

    set -a
    NIX_STATE_DIR="$TMPDIR/nix-state"
    set +a
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
