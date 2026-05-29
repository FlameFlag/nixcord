#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

export DISCORD_BRANCHES="${DISCORD_BRANCHES:-stable,ptb,canary,development}"
exec python3 "${DISCORD_UPDATE_SOURCES_PY:?}"
