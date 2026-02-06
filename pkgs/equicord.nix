{
  fetchFromGitHub,
  git,
  lib,
  nodejs,
  pnpm_10,
  stdenv,
  buildWebExtension ? false,
  writeShellApplication,
  cacert,
  coreutils,
  curl,
  jq,
  nix,
  nix-prefetch-github,
  perl,
}:

let
  version = "v1.14.2.0";
  hash = "sha256-uk4kF6i00jAnHQ8ldjTjO4zv0S+OmMZ5zOqfRb8XWS8=";
  pnpmDeps = "sha256-NAH0j9eTNr8Hf62z4X06Jdez4EJdRmKP6jLBuARK7co=";
in
stdenv.mkDerivation (finalAttrs: {
  pname = "equicord";
  inherit version;

  src = fetchFromGitHub {
    owner = "Equicord";
    repo = "Equicord";
    tag = "${finalAttrs.version}";
    inherit hash;
  };

  pnpmDeps = pnpm_10.fetchDeps {
    inherit (finalAttrs) pname version src;
    hash = pnpmDeps;
    fetcherVersion = 2;
  };

  nativeBuildInputs = [
    git
    nodejs
    pnpm_10
    pnpm_10.configHook
  ];

  env = {
    EQUICORD_REMOTE = "${finalAttrs.src.owner}/${finalAttrs.src.repo}";
    EQUICORD_HASH = "${finalAttrs.src.tag}";
  };

  buildPhase = ''
    runHook preBuild
    pnpm run ${if buildWebExtension then "buildWeb" else "build"} \
      -- --standalone --disable-updater
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist/${lib.optionalString buildWebExtension "chromium-unpacked/"} $out
    runHook postInstall
  '';

  passthru = {
    updateScript = writeShellApplication {
      name = "equicord-update";
      runtimeInputs = [
        cacert
        coreutils
        curl
        jq
        nix
        nix-prefetch-github
        perl
      ];
      text = ''
        NIX_FILE="./pkgs/equicord.nix"
        backup_file="$NIX_FILE.backup.$(date +%s)"
        cp "$NIX_FILE" "$backup_file"

        cleanup() {
          local exit_code=$?
          [[ $exit_code -ne 0 && -f "$backup_file" ]] &&
            cp "$backup_file" "$NIX_FILE"
          rm -f "$backup_file"
          exit $exit_code
        }
        trap cleanup EXIT

        update_inplace() {
          perl -i -pe "$1" "$NIX_FILE"
        }

        echo "Fetching latest Equicord tag..."
        new_tag=$(
          curl -s "https://api.github.com/repos/Equicord/Equicord/tags" |
            jq -r '.[] | select(.name | test("^v\\d+\\.\\d+\\.\\d+(\\.\\d+)?$")) | .name' |
            sort -V -r |
            head -1
        )

        [[ ! "$new_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] && exit 1

        echo "Updating to version: $new_tag"
        new_hash=$(
          if prefetch_output=$(nix-prefetch-github "Equicord" "Equicord" --rev "$new_tag" 2>/dev/null); then
            echo "$prefetch_output" | jq -r .hash
          else
            echo "Failed to prefetch GitHub revision $new_tag" >&2
            exit 1
          fi
        )

        update_inplace "s|version = \".*\";|version = \"$new_tag\";|"
        update_inplace "s|hash = \"sha256-[^\"]*\";|hash = \"$new_hash\";|"

        echo "Updating pnpm dependencies hash..."

        # Temporarily remove the pnpmDeps hash to get the correct one
        perl -i -pe 's/hash = pnpmDeps;/# hash = pnpmDeps;/' "$NIX_FILE"

        build_output=$(
          nix-build -E "with import <nixpkgs> {}; (callPackage ./pkgs/equicord.nix {}).pnpmDeps" \
            --no-link --pure 2>&1
        ) || true

        new_pnpm_hash=$(
          echo "$build_output" |
            grep -oE "got:\s+sha256-[A-Za-z0-9+/=]+" |
            sed 's/got:\s*//' |
            tr -d '[:space:]' |
            head -1
        )

        perl -i -pe 's/# hash = pnpmDeps;/hash = pnpmDeps;/' "$NIX_FILE"

        if [[ -n "$new_pnpm_hash" ]]; then
          update_inplace "s|pnpmDeps = \"sha256-[^\"]*\";|pnpmDeps = \"$new_pnpm_hash\";|"
          echo "Updated pnpmDeps hash to $new_pnpm_hash"
        else
          echo "pnpmDeps hash is already correct or could not be determined"
          exit 1
        fi
        echo "Update complete"
      '';
    };
  };

  meta = {
    description = "Other cutest Discord client mod";
    homepage = "https://github.com/Equicord/Equicord";
    license = lib.licenses.gpl3Only;
    platforms = lib.platforms.unix;
    maintainers = with lib.maintainers; [ FlameFlag ];
  };
})
