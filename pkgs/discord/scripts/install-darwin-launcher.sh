#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  set -euo pipefail
fi

binary_name=$1
launcher_c=$2
disable_breaking_updates=$3
stage_modules=$4
modules_dir=$5
deploy_krisp=$6
target=$7
enable_krisp=$8
enable_autoscroll=$9
cc=${10}
rcodesign=${11}
entitlements=${12}

app_executable="$out/Applications/$binary_name.app/Contents/MacOS/$binary_name"
app_executable_unwrapped="$app_executable.unwrapped"
mv "$app_executable" "$app_executable_unwrapped"

cp "$launcher_c" nixcord-discord-launcher.c
substituteInPlace nixcord-discord-launcher.c \
  --replace-fail "@disable_breaking_updates@" "$disable_breaking_updates" \
  --replace-fail "@stage_modules@" "$stage_modules" \
  --replace-fail "@modules_dir@" "$modules_dir" \
  --replace-fail "@deploy_krisp@" "$deploy_krisp" \
  --replace-fail "@target@" "$target" \
  --replace-fail "@enable_krisp@" "$enable_krisp" \
  --replace-fail "@enable_autoscroll@" "$enable_autoscroll"

"$cc" -Os -o "$app_executable" nixcord-discord-launcher.c
chmod +x "$app_executable"

"$rcodesign" sign \
  --exclude "Contents/Resources/modules/**" \
  --entitlements-xml-file "$entitlements" \
  --entitlements-xml-file "Contents/MacOS/$binary_name.unwrapped:$entitlements" \
  --entitlements-xml-file "Contents/Frameworks/$binary_name Helper.app:$entitlements" \
  --entitlements-xml-file "Contents/Frameworks/$binary_name Helper (GPU).app:$entitlements" \
  --entitlements-xml-file "Contents/Frameworks/$binary_name Helper (Plugin).app:$entitlements" \
  --entitlements-xml-file "Contents/Frameworks/$binary_name Helper (Renderer).app:$entitlements" \
  "$out/Applications/$binary_name.app"
