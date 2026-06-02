#!/usr/bin/env bash
# shellcheck shell=bash

client_name="@clientName@"
nix_file="@nixFile@"
owner="@owner@"
repo="@repo@"
update_kind="@updateKind@"
version_var="@versionVar@"
hash_var="@hashVar@"
rev_var="@revVar@"
pnpm_hash_var="@pnpmHashVar@"
call_package_args="@callPackageArgs@"
stable_tag_regex="@stableTagRegex@"
branch="@branch@"
version_prefix_mode="@versionPrefixMode@"
skip_if_current="@skipIfCurrent@"

wrong_hash="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
parsed_nix_expr=""
original_nix_content=""

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*"
}

read_file_into() {
  local path="$1"
  local -n output_ref="$2"

  # shellcheck disable=SC2034 # output_ref is assigned through a nameref.
  IFS= read -r -d '' output_ref < "$path" || true
}

read_file_into "$nix_file" original_nix_content

cleanup() {
  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    printf '%s' "$original_nix_content" > "$nix_file"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

parse_nix_file() {
  if [[ -z "$parsed_nix_expr" ]]; then
    parsed_nix_expr=$(nix-instantiate --parse "$nix_file") ||
      die "Failed to parse $nix_file"
  fi

  printf '%s\n' "$parsed_nix_expr"
}

nix_string_literal_for() {
  local var_name="$1"
  local parsed
  local attr_re

  [[ "$var_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    die "Invalid Nix variable name: $var_name"

  parsed=$(parse_nix_file)
  attr_re="(^|[[:space:];])${var_name}[[:space:]]=[[:space:]](\"([^\"\\]|\\.)*\");"

  if [[ "$parsed" =~ $attr_re ]]; then
    printf '%s\n' "${BASH_REMATCH[2]}"
    return
  fi

  return 1
}

get_nix_value() {
  local var_name="$1"
  local literal

  literal=$(nix_string_literal_for "$var_name") ||
    die "Could not read $var_name from $nix_file"

  nix eval --impure --raw --expr "$literal" ||
    die "Failed to evaluate $var_name from $nix_file"
}

nix_quote_string() {
  local value="$1"

  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//\$\{/\\\$\{}
  value=${value//$'\n'/\\n}

  printf '"%s"' "$value"
}

update_value() {
  local var_name="$1"
  local new_value="$2"
  local old_value
  local old_assignment
  local new_assignment
  local file_content

  old_value=$(get_nix_value "$var_name")
  old_assignment="  ${var_name} = $(nix_quote_string "$old_value");"
  new_assignment="  ${var_name} = $(nix_quote_string "$new_value");"

  read_file_into "$nix_file" file_content
  [[ "$file_content" == *"$old_assignment"* ]] ||
    die "Could not find assignment for $var_name in $nix_file"

  printf '%s' "${file_content/"$old_assignment"/"$new_assignment"}" > "$nix_file"
  parsed_nix_expr=""
}

gh_curl() {
  local -a curl_args=(-fsSL)

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: token $GITHUB_TOKEN")
  fi

  curl "${curl_args[@]}" "$@"
}

version_gt() {
  local lhs="${1#v}"
  local rhs="${2#v}"
  local -a lhs_parts=()
  local -a rhs_parts=()
  local lhs_part
  local rhs_part
  local part_count
  local index

  IFS=. read -r -a lhs_parts <<< "$lhs"
  IFS=. read -r -a rhs_parts <<< "$rhs"

  part_count=${#lhs_parts[@]}
  if (( ${#rhs_parts[@]} > part_count )); then
    part_count=${#rhs_parts[@]}
  fi

  for ((index = 0; index < part_count; index++)); do
    lhs_part=${lhs_parts[index]:-0}
    rhs_part=${rhs_parts[index]:-0}

    if (( 10#$lhs_part > 10#$rhs_part )); then
      return 0
    elif (( 10#$lhs_part < 10#$rhs_part )); then
      return 1
    fi
  done

  return 1
}

fetch_latest_tag() {
  local tags_json
  local tag_names
  local tag
  local latest_tag=""

  tags_json=$(gh_curl "https://api.github.com/repos/$owner/$repo/tags?per_page=100")
  tag_names=$(jq -r '.[].name // empty' <<< "$tags_json") ||
    die "Failed to parse tags for $owner/$repo"

  while IFS= read -r tag; do
    [[ -n "$tag" ]] || continue
    [[ "$tag" =~ $stable_tag_regex ]] || continue

    if [[ -z "$latest_tag" ]] || version_gt "$tag" "$latest_tag"; then
      latest_tag="$tag"
    fi
  done <<< "$tag_names"

  printf '%s\n' "$latest_tag"
}

prefetch_github_hash() {
  local revision="$1"
  local output
  local hash

  output=$(nix-prefetch-github "$owner" "$repo" --rev "$revision" 2>/dev/null) ||
    die "Failed to prefetch GitHub revision $revision"
  hash=$(jq -r '.hash // empty' <<< "$output") ||
    die "Failed to parse prefetch output for $revision"

  [[ -n "$hash" ]] || die "Prefetch output for $revision did not contain a hash"
  printf '%s\n' "$hash"
}

platform_pnpm_hash_var() {
  if [[ -n "$pnpm_hash_var" ]]; then
    printf '%s\n' "$pnpm_hash_var"
  elif [[ "$OSTYPE" == darwin* ]]; then
    printf '%s\n' "pnpmDepsHashDarwin"
  else
    printf '%s\n' "pnpmDepsHashLinux"
  fi
}

build_and_extract_hash() {
  local build_output
  local nixpkgs_path
  local expr
  local -a nix_build_args=()

  expr="with import <nixpkgs> {}; (callPackage $nix_file $call_package_args).pnpmDeps"
  nixpkgs_path=$(nix eval --impure --raw --expr "(builtins.getFlake (toString ./.)).inputs.nixpkgs.outPath" 2>/dev/null) ||
    nixpkgs_path=""

  nix_build_args=(-E "$expr" --no-link)
  if [[ -n "$nixpkgs_path" ]]; then
    nix_build_args=(-I "nixpkgs=$nixpkgs_path" "${nix_build_args[@]}")
    if build_output=$(nix-build "${nix_build_args[@]}" 2>&1); then
      return 0
    fi
  else
    nix_build_args+=("--pure")
    if build_output=$(nix-build "${nix_build_args[@]}" 2>&1); then
      return 0
    fi
  fi

  if [[ "$build_output" =~ got:[[:space:]]+(sha256-[A-Za-z0-9+/=]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  fi
}

update_pnpm_deps_hash() {
  local hash_var
  local old_hash
  local new_hash

  hash_var=$(platform_pnpm_hash_var)
  old_hash=$(get_nix_value "$hash_var")

  log "Updating pnpm dependencies hash ($hash_var)..."
  update_value "$hash_var" "$wrong_hash"
  new_hash=$(build_and_extract_hash)

  if [[ -n "$new_hash" ]]; then
    update_value "$hash_var" "$new_hash"
    log "Updated $hash_var to $new_hash"
  else
    update_value "$hash_var" "$old_hash"
    log "$hash_var is already correct or could not be determined"
  fi
}

determine_update() {
  update_version=""
  update_revision=""

  if [[ "$update_kind" == "unstable-branch" ]]; then
    local base_tag
    local commit_date
    local commit_json

    base_tag=$(fetch_latest_tag)
    [[ -n "$base_tag" ]] || die "Could not find latest stable tag for $client_name"

    commit_json=$(gh_curl "https://api.github.com/repos/$owner/$repo/commits/$branch")
    update_revision=$(jq -r '.sha // empty' <<< "$commit_json") ||
      die "Failed to parse commit SHA for $branch"
    [[ -n "$update_revision" ]] || die "Could not resolve $owner/$repo branch $branch"

    commit_date=$(jq -r '.commit.committer.date // empty' <<< "$commit_json") ||
      die "Failed to parse commit date for $update_revision"
    commit_date=${commit_date%%T*}
    [[ -n "$commit_date" ]] || die "Could not determine commit date for $update_revision"

    update_version="${base_tag#v}-unstable-$commit_date"
  else
    local tag

    tag=$(fetch_latest_tag)
    [[ -n "$tag" ]] || die "Could not find latest tag for $client_name"

    update_revision="$tag"
    if [[ "$version_prefix_mode" == "strip-v" ]]; then
      update_version="${tag#v}"
    else
      update_version="$tag"
    fi
  fi
}

run_update() {
  case "${1:-}" in
    --pnpm-only)
      update_pnpm_deps_hash
      log "pnpmDeps update complete"
      return
      ;;
    "")
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac

  log "Fetching latest $client_name version..."
  determine_update

  if [[ "$skip_if_current" == "true" && "$(get_nix_value "$version_var")" == "$update_version" ]]; then
    log "Already at latest version $update_version, updating pnpm deps only"
    update_pnpm_deps_hash
    return
  fi

  log "Updating to version: $update_version"
  update_value "$version_var" "$update_version"

  if [[ -n "$rev_var" ]]; then
    update_value "$rev_var" "$update_revision"
  fi

  update_value "$hash_var" "$(prefetch_github_hash "$update_revision")"
  update_pnpm_deps_hash
  log "Update complete"
}

run_update "$@"
