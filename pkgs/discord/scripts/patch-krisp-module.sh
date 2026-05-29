#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC1090,SC2154
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

krisp_src=$1
patch_krisp_py=$2
patch_krisp_module_py=$3
platform=$4

mkdir -p "$out"
brotli -d < "$krisp_src" | tar xf - --strip-components=1 -C "$out"

if [[ "$platform" = linux || "$platform" = darwin ]]; then
  python3 "$patch_krisp_py" "$out/discord_krisp.node"
  python3 "$patch_krisp_module_py" "$out" "$platform"
fi

if [[ "$platform" = darwin ]]; then
  source "${DARWIN_SIGNING_UTILS:?}"
  sign "$out/discord_krisp.node"
fi
