{
  equicord,
  fetchFromGitHub,
  fetchPnpmDeps,
  stdenvNoCC,
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
  version = "v1.14.11.0";
  hash = "sha256-58UE2G2Pvay4wfQuH4CD7QFGizPKWYuLJgJLLJp+6lA=";
  gitHash = "sha256-I0tURUi+jR+bgKvSs3Km8HB0mySiDFMOOBkDM4cMQbY=";
  pnpmDepsHashDarwin = "sha256-8za+KfTNZXROt9zasumUppzCo6/bz3Rrp976mAyaBa4=";
  pnpmDepsHashLinux = "sha256-uEQRrFyHPm90S0TH2T6PEffruaG5YGY33MSgcnFma1U=";
  pnpmDepsHash = if stdenvNoCC.isDarwin then pnpmDepsHashDarwin else pnpmDepsHashLinux;
  owner = equicord.src.owner;
  repo = equicord.src.repo;
  src = fetchFromGitHub {
    inherit owner repo;
    tag = version;
    inherit hash;
  };
  srcWithGit = fetchFromGitHub {
    inherit owner repo;
    tag = version;
    hash = gitHash;
    leaveDotGit = true;
  };
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

      update_value() {
        local var_name="$1"
        local new_value="$2"
        perl -pi -e "s|  $var_name = \".*\";|  $var_name = \"$new_value\";|" "$NIX_FILE"
      }

      get_nix_value() {
        local var_name="$1"
        grep "  $var_name = \"" "$NIX_FILE" | perl -pe 's/.*"(.*)";.*/$1/'
      }

      fetch_latest_tag() {
        local pattern="$1"
        local curl_args=(-s)
        if [[ -n "''${GITHUB_TOKEN:-}" ]]; then
          curl_args+=(-H "Authorization: token $GITHUB_TOKEN")
        fi
        curl "''${curl_args[@]}" "https://api.github.com/repos/${equicord.src.owner}/${equicord.src.repo}/tags" |
          jq -r --arg p "^$pattern" '.[] | select(.name | test($p)) | .name' |
          sort -V -r |
          head -1
      }

      prefetch_github() {
        local rev="$1"
        local leave_dot_git="''${2:-}"
        local output
        if [[ "$leave_dot_git" == "--leave-dot-git" ]]; then
          output=$(nix-prefetch-github "${equicord.src.owner}" "${equicord.src.repo}" --rev "$rev" --leave-dot-git 2>/dev/null) || return 1
        else
          output=$(nix-prefetch-github "${equicord.src.owner}" "${equicord.src.repo}" --rev "$rev" 2>/dev/null) || return 1
        fi
        echo "$output" | jq -r .hash
      }

      update_version_and_hash() {
        local new_tag="$1"
        local new_hash="$2"
        local new_git_hash="$3"
        update_value "version" "$new_tag"
        update_value "hash" "$new_hash"
        update_value "gitHash" "$new_git_hash"
      }

      platform_hash_var() {
        if [[ "$(uname)" == "Darwin" ]]; then
          echo "pnpmDepsHashDarwin"
        else
          echo "pnpmDepsHashLinux"
        fi
      }

      get_current_pnpm_deps_hash() {
        get_nix_value "$(platform_hash_var)" | perl -pe 's/^sha256-//'
      }

      set_pnpm_deps_hash() {
        local hash="$1"
        update_value "$(platform_hash_var)" "$hash"
      }

      build_and_extract_hash() {
        # Use a valid-but-wrong hash to guarantee a clean "hash mismatch" error.
        # An empty string is not valid SRI and can cause a different error without "got:" output.
        set_pnpm_deps_hash "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        local build_output nixpkgs_path
        nixpkgs_path=$(nix eval --impure --raw --expr "(builtins.getFlake (toString ./.)).inputs.nixpkgs.outPath" 2>/dev/null) || nixpkgs_path=""
        if [[ -n "$nixpkgs_path" ]]; then
          build_output=$(nix-build -I "nixpkgs=$nixpkgs_path" -E "with import <nixpkgs> {}; (callPackage $NIX_FILE {}).pnpmDeps" --no-link 2>&1)
        else
          build_output=$(nix-build -E "with import <nixpkgs> {}; (callPackage $NIX_FILE {}).pnpmDeps" --no-link --pure 2>&1)
        fi
        echo "$build_output" | grep -oE "got:\s+sha256-[A-Za-z0-9+/=]+" | perl -pe 's/got:\s*//' | tr -d '[:space:]' | head -1
      }

      update_pnpm_deps() {
        echo "Updating pnpm dependencies hash for $(uname)..."
        old_hash=$(get_current_pnpm_deps_hash)
        new_pnpm_hash=$(build_and_extract_hash)

        if [[ -n "$new_pnpm_hash" ]]; then
          set_pnpm_deps_hash "$new_pnpm_hash"
          echo "Updated $(platform_hash_var) to $new_pnpm_hash"
        else
          set_pnpm_deps_hash "sha256-$old_hash"
          echo "pnpmDepsHash is already correct or could not be determined"
        fi
      }

      if [[ "''${1:-}" == "--pnpm-only" ]]; then
        update_pnpm_deps
        echo "pnpmDeps update complete"
        exit 0
      fi

      echo "Fetching latest Equicord tag..."
      new_tag=$(fetch_latest_tag "v\\d+\\.\\d+\\.\\d+(\\.\\d+)?")

      [[ ! "$new_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] && { echo "Invalid tag format" >&2; exit 1; }

      current_tag=$(get_nix_value "version")
      if [[ "$new_tag" == "$current_tag" ]]; then
        echo "Already at latest version $new_tag, updating pnpm deps only"
        update_pnpm_deps
        exit 0
      fi

      echo "Updating to version: $new_tag"
      new_hash=$(prefetch_github "$new_tag") || { echo "Failed to prefetch GitHub" >&2; exit 1; }
      new_git_hash=$(prefetch_github "$new_tag" --leave-dot-git) || { echo "Failed to prefetch GitHub (git)" >&2; exit 1; }

      update_version_and_hash "$new_tag" "$new_hash" "$new_git_hash"

      update_pnpm_deps
      echo "Update complete"
    '';
  };
in
(equicord.override { inherit buildWebExtension; }).overrideAttrs (oldAttrs: {
  inherit version src;
  pnpmDeps = fetchPnpmDeps {
    inherit src;
    inherit version;
    inherit (oldAttrs) pname;
    inherit (oldAttrs.pnpmDeps) pnpm fetcherVersion;
    hash = pnpmDepsHash;
  };
  passthru.updateScript = updateScript;
  passthru.srcWithGit = srcWithGit;
  env = {
    EQUICORD_REMOTE = "${owner}/${repo}";
    EQUICORD_HASH = "${src.tag}";
  };
})
