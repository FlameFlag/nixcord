#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

resources_dir=$1
openasar_src=$2
asar_bin=$3

cp -f "$openasar_src" "$resources_dir/app.asar"
openasar_dir=$(mktemp -d)

cleanup() {
  rm -rf "$openasar_dir"
}
trap cleanup EXIT

"$asar_bin" extract "$resources_dir/app.asar" "$openasar_dir"
substituteInPlace "$openasar_dir/Constants.js" \
  --replace-fail \
    "USE_NEW_UPDATER:settings.get('USE_NEW_UPDATER')||process.platform==='win32'||process.platform==='linux'" \
    "USE_NEW_UPDATER:settings.get('USE_NEW_UPDATER') ?? (process.platform==='win32'||process.platform==='linux')"
"$asar_bin" pack "$openasar_dir" "$resources_dir/app.asar"
