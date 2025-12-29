{
  fetchFromGitHub,
  git,
  lib,
  nodejs,
  pnpm_10,
  fetchPnpmDeps, 
  pnpmConfigHook,
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
  version = "2025-12-23";
  hash = "sha256-ce5n7E+eJLPnj/dUnaaDi4R8kKO4+iOcQgdtOin4NcM=";
  pnpmDeps = "sha256-iBCA4G1E1Yw/d94pQzcbBGJYeIIgZI+Gw87/x4ogoyg=";
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

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_10;
    hash = pnpmDeps;
    fetcherVersion = 1;
  };

  nativeBuildInputs = [
    git
    nodejs
    pnpm_10
    pnpmConfigHook
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
            jq -r '.[] | select(.name | test("^\\d{4}-\\d{2}-\\d{2}$")) | .name' |
            sort -r |
            head -1
        )

        [[ ! "$new_tag" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && exit 1

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
        old_pnpm_hash=$(
          grep -o 'pnpmDeps = "sha256-[^"]*";' "$NIX_FILE" |
            sed 's/.*"sha256-\([^"]*\)".*/\1/'
        )

        build_output=$(
          nix-build -E "with import <nixpkgs> {}; (callPackage ./pkgs/equicord.nix {}).pnpmDeps" \
            --no-link --pure 2>&1
        ) || true

        new_pnpm_hash=$(
          echo "$build_output" |
            grep -oE "got:\s+sha256-[A-Za-z0-9+/=]+" |
            sed 's/got:\s*//' |
            tr -d '[:space:]' |
            head -1 ||
          echo "$build_output" |
            grep -oE "sha256-[A-Za-z0-9+/=]+" |
            tail -1 |
            tr -d '[:space:]'
        )

        if [[ -n "$new_pnpm_hash" && "$new_pnpm_hash" != "sha256-$old_pnpm_hash" ]]; then
          update_inplace "s|pnpmDeps = \"sha256-[^\"]*\";|pnpmDeps = \"$new_pnpm_hash\";|"
          echo "Updated pnpmDeps hash to $new_pnpm_hash"
        else
          echo "pnpmDeps hash is already correct or could not be determined"
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
