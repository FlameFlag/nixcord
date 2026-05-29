#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

resources_dir=$1
target_prefix=$2
shift 2

mkdir -p "$resources_dir/node_modules"
for module in "$@"; do
  rm -rf "$resources_dir/node_modules/$module"
  ln -s "$target_prefix/$module" "$resources_dir/node_modules/$module"
done
