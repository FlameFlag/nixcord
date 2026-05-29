#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

deploy_krisp_py=$1

mkdir -p "$out/bin"
cp "$deploy_krisp_py" "$out/bin/deploy-krisp.py"
substituteAllInPlace "$out/bin/deploy-krisp.py"
chmod +x "$out/bin/deploy-krisp.py"
