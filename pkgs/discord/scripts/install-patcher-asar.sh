#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

resources_dir=$1
patcher_require=$2

mv "$resources_dir/app.asar" "$resources_dir/_app.asar"
mkdir "$resources_dir/app.asar"
printf '%s\n' '{"name":"discord","main":"index.js"}' > "$resources_dir/app.asar/package.json"
printf '%s\n' "$patcher_require" > "$resources_dir/app.asar/index.js"
