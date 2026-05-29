#!/usr/bin/env bash
# shellcheck shell=bash
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

target=$1
stage_modules=$2
modules_dir=$3
deploy_krisp=$4
enable_krisp=$5
enable_autoscroll=$6

if [[ "$enable_krisp" = 1 ]]; then
  wrapProgramShell "$target" \
    --run "$stage_modules $modules_dir" \
    --run "$deploy_krisp"
else
  wrapProgramShell "$target" \
    --run "$stage_modules $modules_dir"
fi

wrapProgramShell "$target" \
  --prefix LD_LIBRARY_PATH : /run/opengl-driver/lib

if [[ "$enable_krisp" = 1 ]]; then
  wrapProgramShell "$target" \
    --run "$deploy_krisp"
fi

if [[ "$enable_autoscroll" = 1 ]]; then
  wrapProgramShell "$target" \
    --add-flags "--enable-blink-features=MiddleClickAutoscroll"
fi
