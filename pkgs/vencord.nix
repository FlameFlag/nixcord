{
  fetchFromGitHub,
  fetchPnpmDeps,
  lib,
  vencord,
  buildWebExtension ? false,
  unstable ? false,
  writeShellApplication,
  cacert,
  coreutils,
  curl,
  jq,
  nix,
  nix-prefetch-github,
}:
let
  stableVersion = "1.14.2";
  stableHash = "sha256-1459x8G0++jH6NO5n4B5LVjDFjAFkLKFAQygVdqgOAk=";
  stablePnpmDeps = "sha256-K9rjPsODn56kM2k5KZHxY99n8fKvWbRbxuxFpYVXYks=";

  unstableVersion = "1.14.2-unstable-2026-02-20";
  unstableRev = "dc25c8f0461972918b2d73a0d93a3d4b6772b99a";
  unstableHash = "sha256-9nD8NrhW3RqMdm+8dYpn5ak6Mii3/l+rtNE1T7bOLjI=";
  unstablePnpmDeps = "sha256-K9rjPsODn56kM2k5KZHxY99n8fKvWbRbxuxFpYVXYks=";

  version = if unstable then unstableVersion else stableVersion;
  hash = if unstable then unstableHash else stableHash;
  pnpmDepsHash = if unstable then unstablePnpmDeps else stablePnpmDeps;
  rev = if unstable then unstableRev else "v${version}";
  src = fetchFromGitHub {
    inherit (vencord.src) owner repo;
    inherit rev hash;
  };
in
(vencord.override { inherit buildWebExtension; }).overrideAttrs (oldAttrs: {
  inherit version src;
  pnpmDeps = fetchPnpmDeps {
    inherit (oldAttrs) pname patches postPatch;
    inherit (oldAttrs.pnpmDeps) pnpm fetcherVersion;
    inherit src;
    hash = pnpmDepsHash;
  };
  meta = oldAttrs.meta // {
    description = "Vencord web extension" + lib.optionalString unstable " (Unstable)";
  };
  passthru.updateScript = writeShellApplication {
    name = "vencord-update";
    runtimeInputs = [
      cacert
      coreutils
      curl
      jq
      nix
      nix-prefetch-github
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

      update_value() {
        local var_name="$1"
        local new_value="$2"
        perl -pi -e "s|  $var_name = \".*\";|  $var_name = \"$new_value\";|" "$NIX_FILE"
      }

      update_source_hash() {
        local rev="$1"
        local prefix="$2"
        local new_src_hash
        local prefetch_output
        if prefetch_output=$(nix-prefetch-github "${vencord.src.owner}" "${vencord.src.repo}" --rev "$rev" 2>/dev/null); then
          new_src_hash=$(echo "$prefetch_output" | jq -r .hash)
          update_value "''${prefix}Hash" "$new_src_hash"
        else
          echo "Failed to prefetch GitHub revision $rev" >&2
          return 1
        fi
      }

      get_nix_value() {
        local var_name="$1"
        grep "  $var_name = \"" "$NIX_FILE" | perl -pe 's/.*"(.*)";.*/$1/'
      }

      build_and_extract_hash() {
        local build_output
        if build_output=$(nix-build -E "with import <nixpkgs> {}; (callPackage $NIX_FILE { unstable = $UPDATE_BOOL; }).pnpmDeps" --no-link --pure 2>&1); then
          return 0
        fi
        echo "$build_output" | grep -oE "got:\s+sha256-[A-Za-z0-9+/=]+" | perl -pe 's/got:\s*//' | head -1
      }

      update_pnpm_deps_hash() {
        local prefix="$1"
        local old_hash
        local new_hash

        old_hash=$(get_nix_value "''${prefix}PnpmDeps" | perl -pe 's/^sha256-//')
        [[ -z "$old_hash" ]] && return 1

        update_value "''${prefix}PnpmDeps" ""
        new_hash=$(build_and_extract_hash)

        if [[ -z "$new_hash" ]]; then
          update_value "''${prefix}PnpmDeps" "sha256-$old_hash"
          echo "pnpmDeps hash is already correct or could not be determined"
          return 0
        fi

        update_value "''${prefix}PnpmDeps" "$new_hash"
        echo "Updated pnpmDeps hash to $new_hash"
      }

      get_latest_stable_tag() {
        curl -s "https://api.github.com/repos/${vencord.src.owner}/${vencord.src.repo}/tags" |
          jq -r '.[] | select(.name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) | .name' |
          sort -Vr |
          head -1
      }

      fetch_github_commit() {
        local branch="$1"
        local field="$2"
        curl -s "https://api.github.com/repos/${vencord.src.owner}/${vencord.src.repo}/commits/$branch" | jq -r "$field"
      }

      determine_update_version() {
        local prefix="$1"
        local base_version revision commit_date

        if [[ "$prefix" == "unstable" ]]; then
          base_version=$(get_latest_stable_tag | perl -pe 's/^v//')
          revision=$(fetch_github_commit "main" ".sha")
          commit_date=$(fetch_github_commit "$revision" ".commit.committer.date" | cut -d'T' -f1)
          echo "''${base_version}-unstable-''${commit_date}"
        else
          local tag
          tag=$(get_latest_stable_tag)
          echo "''${tag#v}"
        fi
      }

      run_update() {
        local prefix="$1"
        local version revision

        echo "Fetching latest Vencord version..."
        version=$(determine_update_version "$prefix")

        if [[ "$prefix" == "unstable" ]]; then
          revision=$(curl -s "https://api.github.com/repos/${vencord.src.owner}/${vencord.src.repo}/commits/main" | jq -r '.sha')
          update_value "''${prefix}Rev" "$revision"
        else
          revision=$(get_latest_stable_tag)
        fi

        echo "Updating to version: $version"
        update_value "''${prefix}Version" "$version"
        update_source_hash "$revision" "$prefix"
        echo "Updating pnpm dependencies hash..."
        update_pnpm_deps_hash "$prefix"
      }

      run_update "$UPDATE_TYPE"
      echo "Update complete"
    '';
  };
})
