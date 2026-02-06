{
  fetchFromGitHub,
  gitMinimal,
  lib,
  nodejs_22,
  stdenv,
  buildWebExtension ? false,
  unstable ? false,
  pnpm_10,
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
  stableVersion = "1.14.2";
  stableHash = "sha256-1459x8G0++jH6NO5n4B5LVjDFjAFkLKFAQygVdqgOAk=";
  stablePnpmDeps = "sha256-K9rjPsODn56kM2k5KZHxY99n8fKvWbRbxuxFpYVXYks=";

  unstableVersion = "1.14.2-unstable-2026-02-06";
  unstableRev = "50c5124e1cc95062a883c58fc2551b302bd5994f";
  unstableHash = "sha256-1459x8G0++jH6NO5n4B5LVjDFjAFkLKFAQygVdqgOAk=";
  unstablePnpmDeps = "sha256-K9rjPsODn56kM2k5KZHxY99n8fKvWbRbxuxFpYVXYks=";
in
stdenv.mkDerivation (finalAttrs: {
  pname = "vencord" + lib.optionalString unstable "-unstable";
  version = if unstable then unstableVersion else stableVersion;

  src = fetchFromGitHub {
    owner = "Vendicated";
    repo = "Vencord";
    rev = if unstable then unstableRev else "v${finalAttrs.version}";
    hash = if unstable then unstableHash else stableHash;
  };

  patches = [ ./fix-deps.patch ];

  postPatch = ''
    substituteInPlace packages/vencord-types/package.json \
      --replace-fail '"@types/react": "18.3.1"' '"@types/react": "19.0.12"'
  '';

  pnpmDeps = pnpm_10.fetchDeps {
    inherit (finalAttrs)
      pname
      src
      patches
      postPatch
      ;
    hash = if unstable then unstablePnpmDeps else stablePnpmDeps;
    fetcherVersion = 2;
  };

  nativeBuildInputs = [
    gitMinimal
    nodejs_22
    pnpm_10
    pnpm_10.configHook
  ];

  env = {
    VENCORD_REMOTE = "${finalAttrs.src.owner}/${finalAttrs.src.repo}";
    VENCORD_HASH = "${finalAttrs.version}";
  };

  buildPhase = ''
    runHook preBuild
    pnpm run ${if buildWebExtension then "buildWeb" else "build"} \
      -- --standalone --disable-updater
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist/${lib.optionalString buildWebExtension "chromium-unpacked/"} "$out"
    cp package.json "$out"
    runHook postInstall
  '';

  passthru.updateScript = writeShellApplication {
    name = "vencord-update";
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
      NIX_FILE="./pkgs/vencord.nix"
      UPDATE_TYPE="${if unstable then "unstable" else "stable"}"
      UPDATE_BOOL="${if unstable then "true" else "false"}"

      backup_file="$NIX_FILE.backup.$(date +%s)"
      cp "$NIX_FILE" "$backup_file"

      cleanup() {
        local exit_code=$?
        if [[ $exit_code -ne 0 && -f "$backup_file" ]]; then
          cp "$backup_file" "$NIX_FILE"
        fi
        rm -f "$backup_file"
        exit $exit_code
      }
      trap cleanup EXIT

      update_value_perl() {
        local var_name="$1"
        local new_value="$2"
        new_value=$(echo "$new_value" | sed 's/^[ \t]*//;s/[ \t]*$//')
        VAR_NAME="$var_name" NEW_VALUE="$new_value" \
        perl -i -pe '
          my $var_name = $ENV{"VAR_NAME"};
          my $new_value = $ENV{"NEW_VALUE"};
          if (/^(\s*)''${var_name}(\s*=\s*")[^"]*(";\s*)$/) {
            $_ = "$1''${var_name}$2''${new_value}$3";
          }
        ' "$NIX_FILE"
      }

      update_source_hash() {
        local rev="$1"
        local prefix="$2"
        local new_src_hash
        local prefetch_output
        if prefetch_output=$(nix-prefetch-github "${finalAttrs.src.owner}" "${finalAttrs.src.repo}" --rev "$rev" 2>/dev/null); then
          new_src_hash=$(echo "$prefetch_output" | jq -r .hash)
          update_value_perl "''${prefix}Hash" "$new_src_hash"
        else
          echo "Failed to prefetch GitHub revision $rev" >&2
          return 1
        fi
      }

      update_pnpm_deps_hash() {
        local prefix="$1"
        old_hash_line=$(grep -n "''${prefix}PnpmDeps.*=" "$NIX_FILE" | head -1)
        if [[ -n "$old_hash_line" ]]; then
          old_hash=$(echo "$old_hash_line" | sed -n 's/.*"sha256-\([^"]*\)".*/\1/p')
          update_value_perl "''${prefix}PnpmDeps" ""
          if build_output=$(nix-build -E "with import <nixpkgs> {}; (callPackage ./pkgs/vencord.nix { unstable = $UPDATE_BOOL; }).pnpmDeps" --no-link --pure 2>&1); then
            update_value_perl "''${prefix}PnpmDeps" "sha256-$old_hash"
            echo "pnpmDeps hash is already correct or could not be determined"
          else
            if new_pnpm_hash=$(echo "$build_output" | grep -oE "got:\s+sha256-[A-Za-z0-9+/=]+" | sed 's/got:\s*//' | head -1); then
              update_value_perl "''${prefix}PnpmDeps" "$new_pnpm_hash"
              echo "Updated pnpmDeps hash to $new_pnpm_hash"
            elif new_pnpm_hash=$(echo "$build_output" | grep -oE "sha256-[A-Za-z0-9+/=]+" | tail -1); then
              update_value_perl "''${prefix}PnpmDeps" "$new_pnpm_hash"
              echo "Updated pnpmDeps hash to $new_pnpm_hash"
            else
              update_value_perl "''${prefix}PnpmDeps" "sha256-$old_hash"
              echo "pnpmDeps hash is already correct or could not be determined"
            fi
          fi
        fi
      }

      get_latest_stable_tag() {
        curl -s "https://api.github.com/repos/${finalAttrs.src.owner}/${finalAttrs.src.repo}/tags" |
          jq -r '.[] | select(.name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) | .name' |
          sort -Vr |
          head -1
      }

      if [ "$UPDATE_BOOL" = "true" ]; then
        echo "Fetching latest Vencord tag..."
        base_version=$(get_latest_stable_tag | sed 's/^v//')
        revision=$(curl -s "https://api.github.com/repos/Vendicated/Vencord/commits/main" | jq -r '.sha')
        commit_date=$(curl -s "https://api.github.com/repos/Vendicated/Vencord/commits/$revision" | jq -r '.commit.committer.date' | cut -d'T' -f1)
        version="''${base_version}-unstable-''${commit_date}"
        update_value_perl "''${UPDATE_TYPE}Rev" "$revision"
      else
        new_tag=$(get_latest_stable_tag)
        version="''${new_tag#v}"
        revision="$new_tag"
      fi

      echo "Updating to version: $version"
      update_value_perl "''${UPDATE_TYPE}Version" "$version"
      update_source_hash "$revision" "$UPDATE_TYPE"
      echo "Updating pnpm dependencies hash..."
      update_pnpm_deps_hash "$UPDATE_TYPE"
      echo "Update complete"
    '';
  };

  meta = {
    description = "Vencord web extension" + lib.optionalString unstable " (Unstable)";
    homepage = "https://github.com/Vendicated/Vencord";
    license = lib.licenses.gpl3Only;
    maintainers = with lib.maintainers; [ FlameFlag ];
  };
})
