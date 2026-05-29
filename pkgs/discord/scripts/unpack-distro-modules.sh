#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

extract_distro=$1
app_src=$2
krisp_module=${3:-}
shift 3

"${DISCORD_SCRIPT_SHELL:-bash}" "$extract_distro" "$app_src" .

for module_spec in "$@"; do
  module_name=${module_spec%%=*}
  module_src=${module_spec#*=}
  module_dir="modules/$module_name"

  mkdir -p "$module_dir"
  "${DISCORD_SCRIPT_SHELL:-bash}" "$extract_distro" "$module_src" "$module_dir"
done

if [[ -n "$krisp_module" ]]; then
  mkdir -p modules/discord_krisp
  cp -R "$krisp_module/." modules/discord_krisp/
  chmod -R u+w modules/discord_krisp
fi
