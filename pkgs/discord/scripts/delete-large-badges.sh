#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

resources_dir=$1

find "$resources_dir/modules/discord_desktop_core/app/images/badges" \
  -type f -name '*.ico' -size +104857600c -delete 2>/dev/null || true
