#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

src=$1
dest=$2
tarball=$(mktemp)

cleanup() {
  rm -f "$tarball"
}
trap cleanup EXIT

mkdir -p "$dest"
brotli -d < "$src" > "$tarball"
tar xf "$tarball" --strip-components=1 -C "$dest"

if [[ "${DISCORD_RESTORE_DARWIN_SYMLINKS:-0}" = 1 ]]; then
  "${PYTHON:-python3}" "${DISCORD_RESTORE_DARWIN_SYMLINKS_SCRIPT:?}" "$tarball" "$dest"
fi
