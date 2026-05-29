#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

extract_distro=$1
app_src=$2
binary_name=$3
krisp_module=${4:-}
shift 4

mkdir -p "$out/Applications"
"${DISCORD_SCRIPT_SHELL:-bash}" "$extract_distro" "$app_src" "$out/Applications"

for module_spec in "$@"; do
  module_name=${module_spec%%=*}
  module_src=${module_spec#*=}
  module_dir="$out/Applications/$binary_name.app/Contents/Resources/modules/$module_name"

  mkdir -p "$module_dir"
  "${DISCORD_SCRIPT_SHELL:-bash}" "$extract_distro" "$module_src" "$module_dir"
done

if [[ -n "$krisp_module" ]]; then
  krisp_dir="$out/Applications/$binary_name.app/Contents/Resources/modules/discord_krisp"
  mkdir -p "$krisp_dir"
  cp -R "$krisp_module/." "$krisp_dir/"
  chmod -R u+w "$krisp_dir"
fi

mkdir -p "$out/bin"
makeWrapper "$out/Applications/$binary_name.app/Contents/MacOS/$binary_name" "$out/bin/$binary_name" \
  --add-flags ""
